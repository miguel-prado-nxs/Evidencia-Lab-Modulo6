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

// Delay entre llamadas para evitar saturación (3 segundos)
const CALL_DELAY_MS = 3000;

/**
 * Función auxiliar para introducir un delay
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

    // Preparar payload en el formato que espera el agente de Calificación
    const payload = {
      establishment_id: contactId,
      business_name: establishmentData?.name || "Establecimiento",
      phone: establishmentData?.phone || "",
      prospect_name: decisionMakerData?.name || "Contacto",
      email: decisionMakerData?.email || null,
      // Contexto A/B Testing
      ab_test_contact_id: abTestContactId,
      // Agent config
      agent_config_id: agentConfigId,
    };

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

    // Procesar respuesta exitosa
    const result = {
      success: true,
      status: response.data?.status || "completed",
      callId: response.data?.callId,
      duration: response.data?.duration,
      outcome: response.data?.outcome,
      qualificationScore: response.data?.qualificationScore,
      timestamp: new Date().toISOString(),
    };

    await updateContactStatus(abTestContactId, "COMPLETED", result);

    logger.info("[Qualification Worker] Llamada completada exitosamente", {
      abTestContactId,
      callId: result.callId,
      qualificationScore: result.qualificationScore,
    });

    // Delay antes de procesar siguiente llamada
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
