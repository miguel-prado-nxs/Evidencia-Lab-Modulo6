/**
 * Punto de entrada centralizado para el sistema de colas.
 *
 * Re-exporta las colas, funciones de estadísticas, utilidades de conexión
 * Redis y el setup del dashboard de Bull Board.
 */

const {
  sdrCallQueue,
  enqueueSDRCall,
  getSDRQueueStats,
} = require("./sdrCallQueue");
const {
  qualificationCallQueue,
  enqueueQualificationCall,
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

  // Funciones de encolamiento
  enqueueSDRCall,
  enqueueQualificationCall,

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
