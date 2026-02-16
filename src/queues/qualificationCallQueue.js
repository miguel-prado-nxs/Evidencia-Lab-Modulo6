/**
 * Cola de llamadas de Calificación (Qualification).
 *
 * Gestiona el encolamiento y seguimiento de llamadas realizadas por agentes
 * de calificación dentro del sistema de A/B testing. La concurrencia de
 * procesamiento se define en el worker correspondiente, no en la cola misma.
 *
 * Nombre de la cola en Redis: "qualification-calls"
 */

const Queue = require("bull");
const { getBullOptions } = require("./config");
const logger = require("../config/logger");

const qualificationCallQueue = new Queue("qualification-calls", getBullOptions());

// --- Eventos de la cola ---

qualificationCallQueue.on("error", (error) => {
  logger.error("[Qualification Queue] Error:", { error: error.message });
});

qualificationCallQueue.on("waiting", (jobId) => {
  logger.debug("[Qualification Queue] Job en espera", { jobId });
});

qualificationCallQueue.on("active", (job) => {
  logger.info("[Qualification Queue] Procesando job", {
    jobId: job.id,
    contactId: job.data.contactId,
  });
});

qualificationCallQueue.on("completed", (job, result) => {
  logger.info("[Qualification Queue] Job completado", {
    jobId: job.id,
    status: result?.status,
  });
});

qualificationCallQueue.on("failed", (job, error) => {
  logger.error("[Qualification Queue] Job fallido", {
    jobId: job.id,
    error: error.message,
    attemptsMade: job.attemptsMade,
  });
});

qualificationCallQueue.on("stalled", (jobId) => {
  logger.warn("[Qualification Queue] Job estancado (posible crash del worker)", {
    jobId,
  });
});

/**
 * Encola una llamada de Calificación para procesamiento asíncrono.
 *
 * @param {object} jobData - Datos del trabajo a encolar.
 * @param {string} jobData.contactId - ID del contacto (establishment enrichment).
 * @param {string} jobData.abTestContactId - ID del registro en abTestContact.
 * @param {string} jobData.agentConfigId - ID de la configuración del agente.
 * @param {object} jobData.establishmentData - Datos del establecimiento para la llamada.
 * @param {object} [jobData.decisionMakerData] - Datos del tomador de decisiones (si aplica).
 * @param {object} [options={}] - Opciones adicionales para el job.
 * @param {number} [options.priority] - Prioridad del job (menor = mayor prioridad).
 * @param {number} [options.delay] - Retraso en ms antes de procesar.
 * @returns {Promise<object>} Job encolado con id y metadata.
 */
async function enqueueQualificationCall(jobData, options = {}) {
  const {
    contactId,
    abTestContactId,
    agentConfigId,
    establishmentData,
    decisionMakerData,
  } = jobData;

  if (!contactId || !abTestContactId || !agentConfigId) {
    throw new Error(
      "Faltan datos requeridos: contactId, abTestContactId, agentConfigId"
    );
  }

  const job = await qualificationCallQueue.add(
    "qualification-call",
    {
      contactId,
      abTestContactId,
      agentConfigId,
      establishmentData,
      decisionMakerData,
      enqueuedAt: new Date().toISOString(),
    },
    {
      priority: options.priority,
      delay: options.delay,
      jobId: `qualification-${abTestContactId}-${Date.now()}`,
    }
  );

  logger.info("[Qualification Queue] Job encolado", {
    jobId: job.id,
    contactId,
    abTestContactId,
  });

  return job;
}

/**
 * Obtiene estadísticas actuales de la cola de Calificación.
 *
 * @returns {Promise<object>} Conteos de jobs por estado:
 *   waiting, active, completed, failed, delayed.
 */
async function getQualificationQueueStats() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    qualificationCallQueue.getWaitingCount(),
    qualificationCallQueue.getActiveCount(),
    qualificationCallQueue.getCompletedCount(),
    qualificationCallQueue.getFailedCount(),
    qualificationCallQueue.getDelayedCount(),
  ]);

  return {
    name: "qualification-calls",
    waiting,
    active,
    completed,
    failed,
    delayed,
    total: waiting + active + delayed,
  };
}

module.exports = {
  qualificationCallQueue,
  enqueueQualificationCall,
  getQualificationQueueStats,
};
