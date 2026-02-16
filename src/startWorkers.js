/**
 * Punto de entrada para iniciar todos los workers de procesamiento.
 *
 * Este script inicia los workers de:
 * - SDR Call Worker (concurrencia: 3)
 * - Qualification Call Worker (concurrencia: 2)
 *
 * Los workers se ejecutan en proceso continuo y procesan jobs
 * de las colas de Redis en background.
 *
 * Uso:
 *   npm run start:workers
 *
 * En producción (Railway):
 *   Este script se ejecuta como un proceso separado del servidor HTTP.
 */

const logger = require("./config/logger");

// Iniciar workers
logger.info("=== Iniciando Workers de Procesamiento ===");

// Worker de llamadas SDR
require("./workers/sdrCallWorker");
logger.info("Worker SDR iniciado");

// Worker de llamadas de Calificación
require("./workers/qualificationCallWorker");
logger.info("Worker Calificación iniciado");

logger.info("=== Todos los workers están activos ===");
logger.info("Esperando jobs en las colas...");

// Mantener proceso vivo
process.on("SIGTERM", () => {
  logger.info("SIGTERM recibido, cerrando workers...");
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("SIGINT recibido, cerrando workers...");
  process.exit(0);
});

// Manejar errores no capturados
process.on("uncaughtException", (error) => {
  logger.error("Excepción no capturada:", {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Promesa rechazada no manejada:", {
    reason,
    promise,
  });
});
