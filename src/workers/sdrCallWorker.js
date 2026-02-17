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

    // Preparar payload en el formato que espera el agente SDR
    const payload = {
      establishment_id: contactId,
      establishment_name: establishmentData?.name || "Establecimiento",
      phone: establishmentData?.phone || "",
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

    // Procesar respuesta exitosa
    const result = {
      success: true,
      status: response.data?.status || "completed",
      callId: response.data?.callId,
      duration: response.data?.duration,
      outcome: response.data?.outcome,
      timestamp: new Date().toISOString(),
    };

    await updateContactStatus(abTestContactId, "COMPLETED", result);

    logger.info("[SDR Worker] Llamada completada exitosamente", {
      abTestContactId,
      callId: result.callId,
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
