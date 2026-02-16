/**
 * Cola de llamadas SDR (Sales Development Representative).
 *
 * Gestiona el encolamiento y seguimiento de llamadas realizadas por agentes SDR
 * dentro del sistema de A/B testing. La concurrencia de procesamiento se define
 * en el worker correspondiente, no en la cola misma.
 *
 * Nombre de la cola en Redis: "sdr-calls"
 */

const Queue = require("bull");
const { getBullOptions } = require("./config");
const logger = require("../config/logger");

const sdrCallQueue = new Queue("sdr-calls", getBullOptions());

// --- Eventos de la cola ---

sdrCallQueue.on("error", (error) => {
  logger.error("[SDR Queue] Error:", { error: error.message });
});

sdrCallQueue.on("waiting", (jobId) => {
  logger.debug("[SDR Queue] Job en espera", { jobId });
});

sdrCallQueue.on("active", (job) => {
  logger.info("[SDR Queue] Procesando job", {
    jobId: job.id,
    contactId: job.data.contactId,
  });
});

sdrCallQueue.on("completed", (job, result) => {
  logger.info("[SDR Queue] Job completado", {
    jobId: job.id,
    status: result?.status,
  });
});

sdrCallQueue.on("failed", (job, error) => {
  logger.error("[SDR Queue] Job fallido", {
    jobId: job.id,
    error: error.message,
    attemptsMade: job.attemptsMade,
  });
});

sdrCallQueue.on("stalled", (jobId) => {
  logger.warn("[SDR Queue] Job estancado (posible crash del worker)", { jobId });
});

/**
 * Encola una llamada SDR para procesamiento asíncrono.
 *
 * @param {object} jobData - Datos del trabajo a encolar.
 * @param {string} jobData.contactId - ID del contacto (establishment enrichment).
 * @param {string} jobData.abTestContactId - ID del registro en abTestContact.
 * @param {string} jobData.agentConfigId - ID de la configuración del agente.
 * @param {object} jobData.establishmentData - Datos del establecimiento para la llamada.
 * @param {object} [options={}] - Opciones adicionales para el job.
 * @param {number} [options.priority] - Prioridad del job (menor = mayor prioridad).
 * @param {number} [options.delay] - Retraso en ms antes de procesar.
 * @returns {Promise<object>} Job encolado con id y metadata.
 */
async function enqueueSDRCall(jobData, options = {}) {
  const { contactId, abTestContactId, agentConfigId, establishmentData } = jobData;

  if (!contactId || !abTestContactId || !agentConfigId) {
    throw new Error(
      "Faltan datos requeridos: contactId, abTestContactId, agentConfigId"
    );
  }

  const job = await sdrCallQueue.add(
    "sdr-call",
    {
      contactId,
      abTestContactId,
      agentConfigId,
      establishmentData,
      enqueuedAt: new Date().toISOString(),
    },
    {
      priority: options.priority,
      delay: options.delay,
      jobId: `sdr-${abTestContactId}-${Date.now()}`,
    }
  );

  logger.info("[SDR Queue] Job encolado", {
    jobId: job.id,
    contactId,
    abTestContactId,
  });

  return job;
}

/**
 * Obtiene estadísticas actuales de la cola SDR.
 *
 * @returns {Promise<object>} Conteos de jobs por estado:
 *   waiting, active, completed, failed, delayed.
 */
async function getSDRQueueStats() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    sdrCallQueue.getWaitingCount(),
    sdrCallQueue.getActiveCount(),
    sdrCallQueue.getCompletedCount(),
    sdrCallQueue.getFailedCount(),
    sdrCallQueue.getDelayedCount(),
  ]);

  return {
    name: "sdr-calls",
    waiting,
    active,
    completed,
    failed,
    delayed,
    total: waiting + active + delayed,
  };
}

module.exports = {
  sdrCallQueue,
  enqueueSDRCall,
  getSDRQueueStats,
};
