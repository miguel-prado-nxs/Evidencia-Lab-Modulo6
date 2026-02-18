/**
 * Worker de procesamiento de llamadas SDR.
 *
 * Este worker procesa trabajos de la cola "sdr-calls" con un límite de concurrencia
 * de 3 llamadas simultáneas. Cada job representa una llamada a un contacto específico
 * utilizando la configuración del agente SDR asignado en el test A/B.
 *
 * Flujo de procesamiento:
 * 1. Obtiene job de la cola
 * 2. Actualiza estado a CALLED en BD
 * 3. Ejecuta llamada al agente SDR
 * 4. Procesa respuesta y actualiza estado final (COMPLETED/FAILED)
 * 5. Registra resultado en BD
 *
 * Concurrencia: 3 llamadas simultáneas
 * Reintentos: Configurados en Bull (3 intentos por defecto)
 */

const { sdrCallQueue } = require("../queues/sdrCallQueue");
const axios = require("axios");
const { PrismaClient } = require("@prisma/client");
const logger = require("../config/logger");
const config = require("../config/env");

const prisma = new PrismaClient();

const SDR_AGENT_URL = config.agents.sdr.url;
const SDR_API_KEY = config.agents.sdr.apiKey;

// Delay mínimo entre procesamiento de jobs (3 segundos)
const CALL_DELAY_MS = 3000;

// Configuración para polling de estado de llamada
const CALL_STATUS_POLL_INTERVAL_MS = 5000; // Consultar cada 5 segundos
const MAX_CALL_WAIT_TIME_MS = 150000; // Máximo 2.5 minutos de espera para SDR

/**
 * Función auxiliar para introducir un delay
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Consulta el estado de una llamada hasta que termine
 * Hace polling al endpoint de status del agente cada 5 segundos
 */
async function waitForCallCompletion(establishmentId, callId, abTestContactId) {
  const startTime = Date.now();
  let pollCount = 0;

  logger.info("[SDR Worker] Esperando finalización de llamada", {
    establishmentId,
    callId,
    abTestContactId,
    maxWaitTime: `${MAX_CALL_WAIT_TIME_MS / 1000}s`,
  });

  while (Date.now() - startTime < MAX_CALL_WAIT_TIME_MS) {
    pollCount++;
    
    try {
      const statusResponse = await axios.get(
        `${SDR_AGENT_URL}/api/sdr/call-status/${establishmentId}`,
        {
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": SDR_API_KEY,
          },
          timeout: 5000,
          validateStatus: (status) => status < 500, // No lanzar error en 404
        }
      );

      if (statusResponse.status === 200 && statusResponse.data) {
        const { status, isActive, callSid } = statusResponse.data;

        logger.info(`[SDR Worker] Poll #${pollCount} - Estado de llamada`, {
          establishmentId,
          status,
          isActive,
          callSid,
          elapsed: `${Math.round((Date.now() - startTime) / 1000)}s`,
        });

        // Si la llamada ya no está activa o tiene un estado final, terminó
        if (
          !isActive ||
          status === "completed" ||
          status === "failed" ||
          status === "no-answer" ||
          status === "busy" ||
          status === "canceled"
        ) {
          logger.info("[SDR Worker] ✅ Llamada finalizada", {
            establishmentId,
            callId,
            finalStatus: status,
            duration: `${Math.round((Date.now() - startTime) / 1000)}s`,
            polls: pollCount,
          });
          return { status, duration: Date.now() - startTime };
        }
      } else if (statusResponse.status === 404) {
        // Si no existe registro (ya fue limpiado), asumir que terminó
        logger.info("[SDR Worker] ✅ Llamada no encontrada (ya finalizada)", {
          establishmentId,
          duration: `${Math.round((Date.now() - startTime) / 1000)}s`,
        });
        return { status: "completed", duration: Date.now() - startTime };
      }
    } catch (error) {
      // Error de conexión o timeout
      if (error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT") {
        logger.warn(
          `[SDR Worker] Poll #${pollCount} - Error de conexión al agente`,
          {
            error: error.message,
            elapsed: `${Math.round((Date.now() - startTime) / 1000)}s`,
          }
        );
        // Continuar polling, el agente puede estar reiniciándose
      } else {
        logger.error(`[SDR Worker] Poll #${pollCount} - Error consultando estado`, {
          error: error.message,
          establishmentId,
        });
      }
    }

    // Esperar intervalo antes de siguiente consulta
    await delay(CALL_STATUS_POLL_INTERVAL_MS);
  }

  // Si llegamos al máximo tiempo de espera, asumir que terminó
  logger.warn("[SDR Worker] ⚠️ Timeout alcanzado, liberando slot", {
    establishmentId,
    callId,
    duration: `${Math.round((Date.now() - startTime) / 1000)}s`,
    polls: pollCount,
  });
  
  return { status: "timeout", duration: Date.now() - startTime };
}

/**
 * Actualiza el estado de un contacto en el test A/B
 */
async function updateContactStatus(abTestContactId, status, result = null, calledAt = null) {
  try {
    // Verificar que el contacto existe antes de actualizar
    const existingContact = await prisma.abTestContact.findUnique({
      where: { id: abTestContactId },
    });

    if (!existingContact) {
      logger.warn("[SDR Worker] Contacto no encontrado en BD, omitiendo actualización", {
        abTestContactId,
        status,
      });
      return; // No lanzar error, solo advertir
    }

    const updateData = {
      status,
      result: result ? JSON.stringify(result) : null,
    };

    if (calledAt) {
      updateData.calledAt = calledAt;
    }

    await prisma.abTestContact.update({
      where: { id: abTestContactId },
      data: updateData,
    });

    logger.info("[SDR Worker] Estado actualizado", {
      abTestContactId,
      status,
    });
  } catch (error) {
    logger.error("[SDR Worker] Error actualizando estado", {
      abTestContactId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Ejecuta la llamada al agente SDR
 */
async function executeSDRCall(jobData) {
  const { contactId, abTestContactId, agentConfigId, establishmentData } = jobData;

  try {
    logger.info("[SDR Worker] Iniciando llamada SDR", {
      abTestContactId,
      contactId,
      agentConfigId,
    });

    // Actualizar estado a CALLED antes de ejecutar
    await updateContactStatus(abTestContactId, "CALLED", null, new Date());

    // Formatear número de teléfono a formato internacional E.164
    let formattedPhone = establishmentData?.phone || "";
    if (formattedPhone && !formattedPhone.startsWith('+')) {
      // Agregar código de país para México si no tiene
      formattedPhone = `+52${formattedPhone}`;
    }

    // Preparar payload en el formato que espera el agente SDR
    const payload = {
      establishment_id: contactId,
      establishment_name: establishmentData?.name || "Establecimiento",
      phone: formattedPhone,
      employee_range: establishmentData?.employeeRange || "0 a 5 personas",
      address: establishmentData?.address || "",
      // Contexto A/B Testing
      ab_test_contact_id: abTestContactId,
    };

    // Incluir agent_config solo si el agentConfigId no es de prueba
    if (agentConfigId && !agentConfigId.startsWith('test-')) {
      payload.agent_config = {
        id: agentConfigId,
        name: establishmentData?.agentConfigName || "Agente SDR",
      };
    }

    // Ejecutar llamada al agente SDR
    const response = await axios.post(
      `${SDR_AGENT_URL}/api/sdr/initiate-call`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": SDR_API_KEY,
        },
        timeout: 60000, // 60 segundos de timeout
      }
    );

    const callId = response.data?.callId;
    const establishmentId = contactId;

    logger.info("[SDR Worker] Llamada iniciada, monitoreando estado", {
      abTestContactId,
      callId,
      establishmentId,
    });

    // CRÍTICO: Esperar a que la llamada termine consultando su estado real
    // Esto asegura que Bull Queue respete el límite de concurrencia de llamadas FÍSICAS
    const callResult = await waitForCallCompletion(establishmentId, callId, abTestContactId);

    // Procesar respuesta exitosa después de que la llamada terminó
    const result = {
      success: true,
      status: callResult.status,
      callId: callId,
      duration: Math.round(callResult.duration / 1000), // En segundos
      outcome: response.data?.outcome,
      timestamp: new Date().toISOString(),
    };

    await updateContactStatus(abTestContactId, "COMPLETED", result);

    logger.info("[SDR Worker] ✅ Llamada completada, slot liberado", {
      abTestContactId,
      callId,
      status: callResult.status,
      duration: `${result.duration}s`,
    });

    // Delay adicional antes de procesar siguiente llamada
    await delay(CALL_DELAY_MS);

    return result;
  } catch (error) {
    logger.error("[SDR Worker] Error en llamada SDR", {
      abTestContactId,
      error: error.message,
      response: error.response?.data,
    });

    // Registrar fallo
    const result = {
      success: false,
      error: error.message,
      errorCode: error.response?.status,
      errorData: error.response?.data,
      timestamp: new Date().toISOString(),
    };

    await updateContactStatus(abTestContactId, "FAILED", result);

    throw error; // Re-lanzar para que Bull maneje el retry
  }
}

/**
 * Procesador de trabajos de la cola SDR
 */
sdrCallQueue.process(
  "sdr-call", // Tipo de trabajo
  3, // Concurrencia: máximo 3 llamadas simultáneas
  async (job) => {
    const { contactId, abTestContactId, agentConfigId, establishmentData } = job.data;

    logger.info("[SDR Worker] Procesando job", {
      jobId: job.id,
      abTestContactId,
      attemptsMade: job.attemptsMade,
    });

    try {
      // Validar datos requeridos
      if (!contactId || !abTestContactId || !agentConfigId) {
        throw new Error("Faltan datos requeridos en el job");
      }

      // Ejecutar llamada
      const result = await executeSDRCall(job.data);

      logger.info("[SDR Worker] Job completado", {
        jobId: job.id,
        abTestContactId,
        success: result.success,
      });

      return result;
    } catch (error) {
      logger.error("[SDR Worker] Job falló", {
        jobId: job.id,
        abTestContactId,
        attemptsMade: job.attemptsMade,
        error: error.message,
      });

      // Si ya se hicieron todos los reintentos, marcar como fallido definitivamente
      if (job.attemptsMade >= job.opts.attempts) {
        logger.error("[SDR Worker] Job falló definitivamente después de todos los reintentos", {
          jobId: job.id,
          abTestContactId,
        });
      }

      throw error; // Re-lanzar para que Bull maneje el retry
    }
  }
);

// Eventos del worker
sdrCallQueue.on("error", (error) => {
  logger.error("[SDR Worker] Error general del worker:", { error: error.message });
});

sdrCallQueue.on("stalled", (job) => {
  logger.warn("[SDR Worker] Job estancado (posible crash)", {
    jobId: job.id,
    abTestContactId: job.data?.abTestContactId,
  });
});

logger.info("[SDR Worker] Iniciado con concurrencia de 3 llamadas");

module.exports = { sdrCallQueue };
