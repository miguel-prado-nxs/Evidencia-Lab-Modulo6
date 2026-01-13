/**
 * Twenty Sync Worker
 * Worker que procesa jobs de sincronizacion con Twenty CRM
 * 
 * Caracteristicas:
 * - Polling periodico de jobs pendientes
 * - Procesamiento en serie para evitar rate limiting
 * - Backoff exponencial en caso de errores
 * - Solo se inicia si TWENTY_API_KEY esta configurada
 */

const config = require("../config/env");
const logger = require("../config/logger");
const { processPendingJobs, getSyncStats } = require("../services/twenty/twentySyncService");

let isRunning = false;
let intervalId = null;

/**
 * Inicia el worker de sincronizacion
 */
function start() {
  if (!config.twenty.apiKey) {
    logger.info("[TwentySyncWorker] TWENTY_API_KEY no configurada - worker no iniciado");
    return;
  }

  if (!config.twenty.syncEnabled) {
    logger.info("[TwentySyncWorker] Sync deshabilitado por configuracion");
    return;
  }

  if (isRunning) {
    logger.warn("[TwentySyncWorker] Worker ya esta corriendo");
    return;
  }

  isRunning = true;
  const intervalMs = config.twenty.syncIntervalMs || 10000;

  logger.info("[TwentySyncWorker] Iniciando worker de sincronizacion", {
    intervalMs,
    baseUrl: config.twenty.baseUrl,
  });

  // Ejecutar inmediatamente la primera vez
  runCycle();

  // Configurar intervalo
  intervalId = setInterval(runCycle, intervalMs);
}

/**
 * Detiene el worker
 */
function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  isRunning = false;
  logger.info("[TwentySyncWorker] Worker detenido");
}

/**
 * Ejecuta un ciclo de procesamiento
 */
async function runCycle() {
  try {
    const result = await processPendingJobs(5); // Procesar hasta 5 jobs por ciclo

    if (result.processed > 0) {
      logger.info("[TwentySyncWorker] Ciclo completado", {
        processed: result.processed,
        success: result.success,
        failed: result.failed,
      });
    }
  } catch (error) {
    logger.error("[TwentySyncWorker] Error en ciclo de procesamiento", {
      error: error.message,
    });
  }
}

/**
 * Obtiene el estado del worker
 */
async function getStatus() {
  const stats = await getSyncStats();

  return {
    isRunning,
    intervalMs: config.twenty.syncIntervalMs,
    enabled: config.twenty.syncEnabled,
    hasApiKey: !!config.twenty.apiKey,
    ...stats,
  };
}

module.exports = {
  start,
  stop,
  getStatus,
};
