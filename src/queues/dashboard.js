/**
 * Configuración de Bull Board para monitoreo visual de colas.
 *
 * Bull Board provee un dashboard web que permite inspeccionar en tiempo real
 * el estado de los jobs: pendientes, activos, completados, fallidos y
 * estancados. También permite reintentar jobs fallidos y limpiar colas.
 *
 * Ruta de acceso: /admin/queues
 */

const { createBullBoard } = require("@bull-board/api");
const { BullAdapter } = require("@bull-board/api/bullAdapter");
const { ExpressAdapter } = require("@bull-board/express");
const { sdrCallQueue } = require("./sdrCallQueue");
const { qualificationCallQueue } = require("./qualificationCallQueue");
const logger = require("../config/logger");

/**
 * Monta el dashboard de Bull Board como middleware en la app Express.
 *
 * @param {import('express').Application} app - Instancia de Express.
 */
function setupBullBoard(app) {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/admin/queues");

  createBullBoard({
    queues: [
      new BullAdapter(sdrCallQueue),
      new BullAdapter(qualificationCallQueue),
    ],
    serverAdapter,
  });

  app.use("/admin/queues", serverAdapter.getRouter());

  logger.info(
    "[Bull Board] Dashboard de colas disponible en /admin/queues"
  );
}

module.exports = { setupBullBoard };
