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

// Delay entre llamadas para evitar saturación (3 segundos)
const CALL_DELAY_MS = 3000;

// Tiempo estimado promedio de duración de llamada SDR (90 segundos)
// Este delay asegura que el worker no complete el job hasta que la llamada termine
const ESTIMATED_CALL_DURATION_MS = 90000; // 90 segundos

// Intervalo para polling de estado de llamada
const CALL_STATUS_POLL_INTERVAL_MS = 10000; // 10 segundos

/**
 * Función auxiliar para introducir un delay
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Espera a que la llamada termine consultando el estado periódicamente
 * Si el agente no tiene endpoint de status, usa delay estimado
 */
async function waitForCallCompletion(establishmentId, callId, abTestContactId) {
  const maxWaitTime = 150000; // Máximo 2.5 minutos de espera para SDR
  const startTime = Date.now();

  logger.info("[SDR Worker] Esperando finalización de llamada", {
    establishmentId,
    callId,
    maxWaitTime: `${maxWaitTime / 1000}s`,
  });

  // Intentar consultar el estado de la llamada cada 10 segundos
  while (Date.now() - startTime < maxWaitTime) {
    try {
      // Intentar obtener estado de la llamada del agente
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
        const { status, isActive } = statusResponse.data;

        // Si la llamada ya no está activa, terminó
        if (!isActive || status === "completed" || status === "failed" || status === "no-answer") {
          logger.info("[SDR Worker] Llamada finalizada", {
            establishmentId,
            callId,
            status,
            duration: `${(Date.now() - startTime) / 1000}s`,
          });
          return;
        }

        logger.info("[SDR Worker] Llamada en curso", {
          establishmentId,
          status,
          elapsed: `${(Date.now() - startTime) / 1000}s`,
        });
      }
    } catch (error) {
      // Si el endpoint no existe (404), usar delay estimado
      if (error.response?.status === 404 || error.code === "ECONNREFUSED") {
        logger.warn(
          "[SDR Worker] Endpoint de status no disponible, usando delay estimado",
          {
            establishmentId,
            estimatedDuration: `${ESTIMATED_CALL_DURATION_MS / 1000}s`,
          }
        );
        await delay(ESTIMATED_CALL_DURATION_MS);
        return;
      }

      // Otro error, continuar polling
      logger.error("[SDR Worker] Error consultando estado de llamada", {
        error: error.message,
      });
    }

    // Esperar intervalo antes de siguiente consulta
    await delay(CALL_STATUS_POLL_INTERVAL_MS);
  }

  // Si llegamos al máximo tiempo de espera
  logger.warn("[SDR Worker] Tiempo máximo de espera alcanzado", {
    establishmentId,
    callId,
    duration: `${(Date.now() - startTime) / 1000}s`,
  });
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

    logger.info("[SDR Worker] Llamada iniciada, esperando finalización", {
      abTestContactId,
      callId,
      establishmentId,
    });

    // CRÍTICO: Esperar a que la llamada termine antes de completar el job
    // Esto asegura que Bull Queue respete el límite de concurrencia
    await waitForCallCompletion(establishmentId, callId, abTestContactId);

    // Procesar respuesta exitosa después de que la llamada terminó
    const result = {
      success: true,
      status: "completed",
      callId: callId,
      timestamp: new Date().toISOString(),
    };

    await updateContactStatus(abTestContactId, "COMPLETED", result);

    logger.info("[SDR Worker] Llamada completada exitosamente", {
      abTestContactId,
      callId,
    });

    // Delay antes de procesar siguiente llamada
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
