/**
 * Punto de entrada centralizado para el sistema de colas.
 *
 * Re-exporta las colas, funciones de estadísticas, utilidades de conexión
 * Redis y el setup del dashboard de Bull Board.
 */

const {
  createRedisClient,
  getBullOptions,
  getHealthClient,
} = require("./config");
const { setupBullBoard } = require("./dashboard");

module.exports = {
  // Configuración Redis
  createRedisClient,
  getBullOptions,
  getHealthClient,

  // Dashboard
  setupBullBoard,
};
