/**
 * Middleware para validar requests del agente de enriquecimiento externo
 * Requiere API Key específica para el agente
 */
const logger = require("../config/logger");

/**
 * Valida que el request provenga del agente de enriquecimiento autorizado
 * mediante una API Key específica en el header X-Enrichment-Agent-Key
 */
function validateEnrichmentAgent(req, res, next) {
  const agentKey = req.headers['x-enrichment-agent-key'];
  const validAgentKey = process.env.ENRICHMENT_AGENT_KEY;

  // Verificar que la key esté configurada en el servidor
  if (!validAgentKey) {
    logger.error('[Enrichment Agent] ENRICHMENT_AGENT_KEY no configurada en variables de entorno');
    return res.status(500).json({ 
      success: false,
      error: 'Configuración del servidor incompleta' 
    });
  }

  // Verificar que el request incluya la key
  if (!agentKey) {
    logger.warn('[Enrichment Agent] Request sin agent key', {
      ip: req.ip,
      path: req.path,
      method: req.method,
      userAgent: req.get('user-agent')
    });
    return res.status(401).json({ 
      success: false,
      error: 'X-Enrichment-Agent-Key header requerido' 
    });
  }

  // Validar que la key sea correcta
  if (agentKey !== validAgentKey) {
    logger.warn('[Enrichment Agent] Agent key inválida', {
      ip: req.ip,
      path: req.path,
      providedKey: agentKey.substring(0, 8) + '...',
      timestamp: new Date().toISOString()
    });
    return res.status(403).json({ 
      success: false,
      error: 'X-Enrichment-Agent-Key inválida' 
    });
  }

  // Validación opcional de IP del agente (whitelist)
  const agentIPs = process.env.ENRICHMENT_AGENT_IPS?.split(',').map(ip => ip.trim()) || [];
  if (agentIPs.length > 0) {
    const clientIP = req.ip || req.headers['x-forwarded-for']?.split(',')[0];
    if (!agentIPs.includes(clientIP)) {
      logger.warn('[Enrichment Agent] Request desde IP no autorizada', {
        ip: clientIP,
        allowedIPs: agentIPs,
        path: req.path
      });
      // No bloqueamos, solo loggeamos (la key es suficiente validación)
    }
  }

  logger.info('[Enrichment Agent] Request autorizada', {
    path: req.path,
    method: req.method,
    ip: req.ip
  });

  next();
}

module.exports = { validateEnrichmentAgent };
