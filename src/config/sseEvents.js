/**
 * SSE Events Manager
 * Maneja Server-Sent Events para notificaciones en tiempo real
 * 
 * Alternativa ligera a WebSockets para eventos unidireccionales (servidor -> cliente)
 * Ideal para notificar cambios de nivel de enriquecimiento cuando el agente actualiza datos
 */

const EventEmitter = require("events");
const logger = require("./logger");

// EventEmitter global para eventos de enriquecimiento
const enrichmentEvents = new EventEmitter();

// Aumentar límite de listeners (varios clientes pueden estar suscritos)
enrichmentEvents.setMaxListeners(100);

// Mapa de clientes SSE conectados: partnerId -> Set de response objects
const connectedClients = new Map();

/**
 * Registrar un cliente SSE
 * @param {string} partnerId - ID del partner
 * @param {object} res - Response object de Express
 */
function registerClient(partnerId, res) {
  if (!connectedClients.has(partnerId)) {
    connectedClients.set(partnerId, new Set());
  }
  connectedClients.get(partnerId).add(res);
  logger.info(`[SSE] Cliente registrado para partner ${partnerId}. Total: ${connectedClients.get(partnerId).size}`);
}

/**
 * Desregistrar un cliente SSE
 * @param {string} partnerId - ID del partner
 * @param {object} res - Response object de Express
 */
function unregisterClient(partnerId, res) {
  const clients = connectedClients.get(partnerId);
  if (clients) {
    clients.delete(res);
    if (clients.size === 0) {
      connectedClients.delete(partnerId);
    }
    logger.info(`[SSE] Cliente desconectado para partner ${partnerId}. Restantes: ${clients?.size || 0}`);
  }
}

/**
 * Enviar evento a un partner específico
 * @param {string} partnerId - ID del partner
 * @param {string} eventType - Tipo de evento (enrichment:updated, enrichment:level-changed)
 * @param {object} data - Datos del evento
 */
function sendToPartner(partnerId, eventType, data) {
  const clients = connectedClients.get(partnerId);
  if (!clients || clients.size === 0) {
    logger.debug(`[SSE] No hay clientes conectados para partner ${partnerId}`);
    return;
  }

  const message = formatSSEMessage(eventType, data);
  
  clients.forEach((res) => {
    try {
      res.write(message);
    } catch (error) {
      logger.error(`[SSE] Error enviando a cliente: ${error.message}`);
      // Limpiar cliente muerto
      clients.delete(res);
    }
  });

  logger.info(`[SSE] Evento ${eventType} enviado a ${clients.size} cliente(s) del partner ${partnerId}`);
}

/**
 * Formatear mensaje SSE según especificación
 * @param {string} eventType - Tipo de evento
 * @param {object} data - Datos del evento
 * @returns {string} - Mensaje formateado
 */
function formatSSEMessage(eventType, data) {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Emitir evento de enriquecimiento actualizado
 * @param {object} params - Parámetros del evento
 * @param {string} params.partnerId - ID del partner dueño del enriquecimiento
 * @param {string} params.establishmentId - ID del establecimiento
 * @param {string} params.previousLevel - Nivel anterior (CONTACT, PROSPECT, LEAD, CLIENT)
 * @param {string} params.newLevel - Nuevo nivel
 * @param {object} params.enrichment - Datos del enriquecimiento actualizado
 */
function emitEnrichmentUpdated({ partnerId, establishmentId, previousLevel, newLevel, enrichment }) {
  const eventData = {
    establishmentId,
    previousLevel,
    newLevel,
    enrichment,
    timestamp: new Date().toISOString(),
  };

  // Emitir evento interno (para posibles listeners del servidor)
  enrichmentEvents.emit("enrichment:updated", { partnerId, ...eventData });

  // Enviar a clientes SSE conectados
  if (partnerId) {
    sendToPartner(partnerId, "enrichment:updated", eventData);
  }

  logger.info(`[SSE] Evento enrichment:updated emitido para ${establishmentId}: ${previousLevel || 'N/A'} -> ${newLevel}`);
}

/**
 * Emitir evento de nivel cambiado (específico para cambios de nivel)
 * @param {object} params - Parámetros del evento
 */
function emitLevelChanged({ partnerId, establishmentId, previousLevel, newLevel, enrichment }) {
  if (previousLevel === newLevel) return; // No emitir si no cambió

  const eventData = {
    establishmentId,
    previousLevel,
    newLevel,
    enrichment: {
      id: enrichment.id,
      level: newLevel,
      decisionMakerName: enrichment.decisionMakerName,
      updatedAt: enrichment.updatedAt,
    },
    timestamp: new Date().toISOString(),
  };

  // Emitir evento interno
  enrichmentEvents.emit("enrichment:level-changed", { partnerId, ...eventData });

  // Enviar a clientes SSE conectados
  if (partnerId) {
    sendToPartner(partnerId, "enrichment:level-changed", eventData);
  }

  logger.info(`[SSE] Evento level-changed emitido: ${establishmentId} de ${previousLevel} a ${newLevel}`);
}

/**
 * Obtener número de clientes conectados
 * @returns {number} - Total de clientes conectados
 */
function getConnectedClientsCount() {
  let total = 0;
  connectedClients.forEach((clients) => {
    total += clients.size;
  });
  return total;
}

/**
 * Obtener estadísticas de conexiones SSE
 * @returns {object} - Estadísticas
 */
function getStats() {
  const stats = {
    totalConnections: 0,
    partnerConnections: {},
  };

  connectedClients.forEach((clients, partnerId) => {
    stats.partnerConnections[partnerId] = clients.size;
    stats.totalConnections += clients.size;
  });

  return stats;
}

module.exports = {
  enrichmentEvents,
  registerClient,
  unregisterClient,
  sendToPartner,
  emitEnrichmentUpdated,
  emitLevelChanged,
  getConnectedClientsCount,
  getStats,
  formatSSEMessage,
};
