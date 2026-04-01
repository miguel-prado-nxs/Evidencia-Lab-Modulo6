const express = require("express");
const { SSEServerTransport } = require("@modelcontextprotocol/sdk/server/sse.js");
const { validateEnrichmentAgent } = require("../middleware/enrichmentAgent");
const { createDiscoveryServer } = require("../mcp/discoveryMcp");
const { createActivationServer } = require("../mcp/activationMcp");
const { createQualificationServer } = require("../mcp/qualificationMcp");
const { createConversionServer } = require("../mcp/conversionMcp");
const logger = require("../config/logger");

const router = express.Router();

// Active SSE transports keyed by sessionId, grouped per agent
const activeTransports = {
  discovery: new Map(),
  activation: new Map(),
  qualification: new Map(),
  conversion: new Map(),
};

/**
 * Monta dos rutas por agente:
 *  GET  /mcp/<agent>/sse       → ElevenLabs se conecta aquí (SSE)
 *  POST /mcp/<agent>/messages  → ElevenLabs envía tool-call JSON-RPC aquí
 */
function mountMcpAgent(agentKey, createServer) {
  // ── SSE connection ─────────────────────────────────────────────────────────
  router.get(`/${agentKey}/sse`, validateEnrichmentAgent, async (req, res) => {
    try {
      const server = createServer();
      const transport = new SSEServerTransport(`/mcp/${agentKey}/messages`, res);

      activeTransports[agentKey].set(transport.sessionId, transport);
      logger.info(`[MCP:${agentKey}] SSE connected`, { sessionId: transport.sessionId });

      await server.connect(transport);

      req.on("close", () => {
        activeTransports[agentKey].delete(transport.sessionId);
        logger.info(`[MCP:${agentKey}] SSE disconnected`, { sessionId: transport.sessionId });
      });
    } catch (err) {
      logger.error(`[MCP:${agentKey}] SSE error`, { error: err.message });
      if (!res.headersSent) res.status(500).end();
    }
  });

  // ── Message handler ────────────────────────────────────────────────────────
  router.post(`/${agentKey}/messages`, validateEnrichmentAgent, async (req, res) => {
    const { sessionId } = req.query;
    const transport = activeTransports[agentKey].get(sessionId);

    if (!transport) {
      logger.warn(`[MCP:${agentKey}] Session not found`, { sessionId });
      return res.status(404).json({ error: "Session not found" });
    }

    try {
      await transport.handlePostMessage(req, res, req.body);
    } catch (err) {
      logger.error(`[MCP:${agentKey}] Message handling error`, { error: err.message });
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });
}

mountMcpAgent("discovery", createDiscoveryServer);
mountMcpAgent("activation", createActivationServer);
mountMcpAgent("qualification", createQualificationServer);
mountMcpAgent("conversion", createConversionServer);

module.exports = router;
