/**
 * Worker de procesamiento de llamadas de Calificación.
 *
 * Este worker procesa trabajos de la cola "qualification-calls" con un límite de
 * concurrencia de 2 llamadas simultáneas. Cada job representa una llamada a un
 * contacto específico utilizando la configuración del agente de Calificación
 * asignado en el test A/B.
 *
 * Flujo de procesamiento:
 * 1. Obtiene job de la cola
 * 2. Actualiza estado a CALLED en BD
 * 3. Ejecuta llamada al agente de Calificación
 * 4. Procesa respuesta y actualiza estado final (COMPLETED/FAILED)
 * 5. Registra resultado en BD
 *
 * Concurrencia: 2 llamadas simultáneas
 * Reintentos: Configurados en Bull (3 intentos por defecto)
 */

const { qualificationCallQueue } = require("../queues/qualificationCallQueue");
const axios = require("axios");
const { PrismaClient } = require("@prisma/client");
const logger = require("../config/logger");
const config = require("../config/env");

const prisma = new PrismaClient();

const QUALIFICATION_AGENT_URL = config.agents.qualification.url;
const QUALIFICATION_API_KEY = config.agents.qualification.apiKey;

// Delay mínimo entre procesamiento de jobs (3 segundos)
const CALL_DELAY_MS = 3000;

// Configuración de polling para monitoreo de estado de llamada
const CALL_STATUS_POLLING_INTERVAL_MS = 5000; // 5 segundos entre consultas
const CALL_STATUS_MAX_WAIT_TIME_MS = 180000; // 3 minutos máximo de espera

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

  logger.info("[Qualification Worker] Esperando finalización de llamada", {
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
        
        logger.info("[Qualification Worker] ✅ Llamada finalizada", {
          establishmentId,
          abTestContactId,
          finalStatus: currentStatus || 'unknown',
          duration: `${duration}s`,
        });

        return { duration, finalStatus: currentStatus || 'completed' };
      }

      // Llamada sigue activa, esperar antes de siguiente consulta
      logger.debug("[Qualification Worker] Llamada aún activa, esperando...", {
        establishmentId,
        currentStatus,
        elapsedSeconds: Math.round((Date.now() - startTime) / 1000),
      });

      await delay(CALL_STATUS_POLLING_INTERVAL_MS);
    } catch (error) {
      logger.error("[Qualification Worker] Error consultando call_status", {
        establishmentId,
        error: error.message,
      });
      // En caso de error, esperar y reintentar
      await delay(CALL_STATUS_POLLING_INTERVAL_MS);
    }
  }

  // Timeout alcanzado
  const duration = Math.round((Date.now() - startTime) / 1000);
  logger.warn("[Qualification Worker] ⚠️ Timeout alcanzado esperando finalización", {
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
      logger.warn("[Qualification Worker] Contacto no encontrado en BD, omitiendo actualización", {
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

    logger.info("[Qualification Worker] Estado actualizado", {
      abTestContactId,
      status,
    });
  } catch (error) {
    logger.error("[Qualification Worker] Error actualizando estado", {
      abTestContactId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Ejecuta la llamada al agente de Calificación
 */
async function executeQualificationCall(jobData) {
  const {
    contactId,
    abTestContactId,
    agentConfigId,
    establishmentData,
    decisionMakerData,
  } = jobData;

  try {
    logger.info("[Qualification Worker] Iniciando llamada de Calificación", {
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

    // Preparar payload en el formato que espera el agente de Calificación
    const payload = {
      establishment_id: contactId,
      business_name: establishmentData?.name || "Establecimiento",
      phone: formattedPhone,
      prospect_name: decisionMakerData?.name || "Contacto",
      email: decisionMakerData?.email || null,
      // Contexto A/B Testing
      ab_test_contact_id: abTestContactId,
    };

    // Incluir agent_config solo si el agentConfigId no es de prueba
    // Usar el mismo formato que SDR para consistencia
    if (agentConfigId && !agentConfigId.startsWith('test-')) {
      payload.agent_config = {
        id: agentConfigId,
        name: establishmentData?.agentConfigName || "Agente de Calificación",
      };
    }

    // Ejecutar llamada al agente de Calificación
    const response = await axios.post(
      `${QUALIFICATION_AGENT_URL}/api/qualification/initiate-call`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": QUALIFICATION_API_KEY,
        },
        timeout: 90000, // 90 segundos de timeout (llamadas de calificación pueden ser más largas)
      }
    );

    const callId = response.data?.callId;

    logger.info("[Qualification Worker] Llamada iniciada, monitoreando estado", {
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
      qualificationScore: response.data?.qualificationScore,
      timestamp: new Date().toISOString(),
    };

    await updateContactStatus(abTestContactId, "COMPLETED", result);

    logger.info("[Qualification Worker] ✅ Llamada completada, slot liberado", {
      abTestContactId,
      status: finalStatus,
      duration: `${duration}s`,
    });

    // Delay adicional antes de procesar siguiente llamada
    await delay(CALL_DELAY_MS);

    return result;
  } catch (error) {
    logger.error("[Qualification Worker] Error en llamada de Calificación", {
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
 * Procesador de trabajos de la cola de Calificación
 */
qualificationCallQueue.process(
  "qualification-call", // Tipo de trabajo
  2, // Concurrencia: máximo 2 llamadas simultáneas
  async (job) => {
    const {
      contactId,
      abTestContactId,
      agentConfigId,
      establishmentData,
      decisionMakerData,
    } = job.data;

    logger.info("[Qualification Worker] Procesando job", {
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
      const result = await executeQualificationCall(job.data);

      logger.info("[Qualification Worker] Job completado", {
        jobId: job.id,
        abTestContactId,
        success: result.success,
      });

      return result;
    } catch (error) {
      logger.error("[Qualification Worker] Job falló", {
        jobId: job.id,
        abTestContactId,
        attemptsMade: job.attemptsMade,
        error: error.message,
      });

      // Si ya se hicieron todos los reintentos, marcar como fallido definitivamente
      if (job.attemptsMade >= job.opts.attempts) {
        logger.error(
          "[Qualification Worker] Job falló definitivamente después de todos los reintentos",
          {
            jobId: job.id,
            abTestContactId,
          }
        );
      }

      throw error; // Re-lanzar para que Bull maneje el retry
    }
  }
);

// Eventos del worker
qualificationCallQueue.on("error", (error) => {
  logger.error("[Qualification Worker] Error general del worker:", {
    error: error.message,
  });
});

qualificationCallQueue.on("stalled", (job) => {
  logger.warn("[Qualification Worker] Job estancado (posible crash)", {
    jobId: job.id,
    abTestContactId: job.data?.abTestContactId,
  });
});

logger.info("[Qualification Worker] Iniciado con concurrencia de 2 llamadas");

module.exports = { qualificationCallQueue };
