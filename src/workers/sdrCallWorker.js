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

// Configuración de polling para monitoreo de estado de llamada
const CALL_STATUS_POLLING_INTERVAL_MS = 5000; // 5 segundos entre consultas
const CALL_STATUS_MAX_WAIT_TIME_MS = 150000; // 2.5 minutos máximo de espera (SDR más cortas)

/**
 * Función auxiliar para introducir un delay
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Monitorea el estado de una llamada consultando establishment_enrichments.call_status
 * Espera hasta que la llamada finalice (call_status != 'in_progress', 'calling', 'ringing')
 * 
 * @param {string} establishmentId - ID del establecimiento
 * @param {string} abTestContactId - ID del contacto en A/B test
 * @returns {Promise<{duration: number, finalStatus: string}>}
 */
async function waitForCallCompletion(establishmentId, abTestContactId) {
  const startTime = Date.now();
  const maxEndTime = startTime + CALL_STATUS_MAX_WAIT_TIME_MS;
  const activeStatuses = ['in_progress', 'calling', 'ringing', 'initiated']; // Estados que indican llamada activa

  logger.info("[SDR Worker] Esperando finalización de llamada", {
    establishmentId,
    abTestContactId,
    maxWaitTime: `${CALL_STATUS_MAX_WAIT_TIME_MS / 1000}s`,
  });

  while (Date.now() < maxEndTime) {
    try {
      // Consultar call_status en establishment_enrichments
      const enrichment = await prisma.establishmentEnrichment.findUnique({
        where: { establishmentId },
        select: { callStatus: true },
      });

      const currentStatus = enrichment?.callStatus;

      // Si no hay status o ya no está en estado activo, la llamada terminó
      if (!currentStatus || !activeStatuses.includes(currentStatus.toLowerCase())) {
        const duration = Math.round((Date.now() - startTime) / 1000);
        
        logger.info("[SDR Worker] Llamada finalizada", {
          establishmentId,
          abTestContactId,
          finalStatus: currentStatus || 'unknown',
          duration: `${duration}s`,
        });

        return { duration, finalStatus: currentStatus || 'completed' };
      }

      // Llamada sigue activa, esperar antes de siguiente consulta
      logger.debug("[SDR Worker] Llamada aún activa, esperando...", {
        establishmentId,
        currentStatus,
        elapsedSeconds: Math.round((Date.now() - startTime) / 1000),
      });

      await delay(CALL_STATUS_POLLING_INTERVAL_MS);
    } catch (error) {
      logger.error("[SDR Worker] Error consultando call_status", {
        establishmentId,
        error: error.message,
      });
      // En caso de error, esperar y reintentar
      await delay(CALL_STATUS_POLLING_INTERVAL_MS);
    }
  }

  // Timeout alcanzado
  const duration = Math.round((Date.now() - startTime) / 1000);
  logger.warn("[SDR Worker] Timeout alcanzado esperando finalización", {
    establishmentId,
    abTestContactId,
    duration: `${duration}s`,
  });

  return { duration, finalStatus: 'timeout' };
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
    
    // Limpiar número: remover espacios, guiones, paréntesis, puntos
    formattedPhone = formattedPhone.replace(/[\s\-\(\)\.]/g, '');
    
    // Si ya tiene +52, validar que tenga 12 dígitos en total (+52 + 10 dígitos)
    if (formattedPhone.startsWith('+52')) {
      // Ya tiene código de país
      if (formattedPhone.length !== 13) {
        logger.warn("[SDR Worker] Número con +52 pero longitud incorrecta", {
          original: establishmentData?.phone,
          cleaned: formattedPhone,
          length: formattedPhone.length
        });
      }
    } else if (formattedPhone.startsWith('52') && formattedPhone.length === 12) {
      // Tiene 52 al inicio pero sin +, agregarlo
      formattedPhone = `+${formattedPhone}`;
    } else {
      // No tiene código de país, agregar +52
      // Validar que sea número de 10 dígitos
      if (formattedPhone.length === 10 && /^\d{10}$/.test(formattedPhone)) {
        formattedPhone = `+52${formattedPhone}`;
      } else {
        logger.warn("[SDR Worker] Número con formato inesperado", {
          original: establishmentData?.phone,
          cleaned: formattedPhone,
          length: formattedPhone.length
        });
        // Intentar agregarlo de todos modos
        formattedPhone = `+52${formattedPhone}`;
      }
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

    logger.info("[SDR Worker] Llamada iniciada, monitoreando estado", {
      abTestContactId,
      establishmentId: contactId,
    });

    // CRÍTICO: Esperar a que la llamada realmente finalice consultando call_status en BD
    // Esto sincroniza Bull Queue con el estado real de las llamadas en los agentes
    const { duration, finalStatus } = await waitForCallCompletion(contactId, abTestContactId);

    // Procesar respuesta exitosa después de finalización real
    const result = {
      success: true,
      status: finalStatus === 'timeout' ? 'completed' : 'completed',
      callId: callId,
      duration: duration, // Duración real en segundos
      finalCallStatus: finalStatus,
      outcome: response.data?.outcome,
      timestamp: new Date().toISOString(),
    };

    await updateContactStatus(abTestContactId, "COMPLETED", result);

    logger.info("[SDR Worker] Llamada completada, slot liberado", {
      abTestContactId,
      status: finalStatus,
      duration: `${duration}s`,
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
