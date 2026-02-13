/**
 * Punto de entrada centralizado para el sistema de colas.
 *
 * Re-exporta las colas, funciones de estadísticas, utilidades de conexión
 * Redis y el setup del dashboard de Bull Board.
 */

const { sdrCallQueue, getSDRQueueStats } = require("./sdrCallQueue");
const {
  qualificationCallQueue,
  getQualificationQueueStats,
} = require("./qualificationCallQueue");
const {
  createRedisClient,
  getBullOptions,
  getHealthClient,
} = require("./config");
const { setupBullBoard } = require("./dashboard");

module.exports = {
  // Colas
  sdrCallQueue,
  qualificationCallQueue,

  // Estadísticas
  getSDRQueueStats,
  getQualificationQueueStats,

  // Configuración Redis
  createRedisClient,
  getBullOptions,
  getHealthClient,

  // Dashboard
  setupBullBoard,
};
