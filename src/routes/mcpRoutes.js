const express = require("express");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { SSEServerTransport } = require("@modelcontextprotocol/sdk/server/sse.js");
const { validateEnrichmentAgent } = require("../middleware/enrichmentAgent");
const { createDiscoveryServer } = require("../mcp/discoveryMcp");
const { createActivationServer } = require("../mcp/activationMcp");
const { createQualificationServer } = require("../mcp/qualificationMcp");
const { createConversionServer } = require("../mcp/conversionMcp");
const logger = require("../config/logger");

const router = express.Router();

// Active SSE transports (legacy SSE fallback)
const activeTransports = {
  discovery: new Map(),
  activation: new Map(),
  qualification: new Map(),
  conversion: new Map(),
};

/**
 * Monta endpoints por agente:
 *  POST /mcp/<agent>           → Streamable HTTP (recomendado para ElevenLabs)
 *  GET  /mcp/<agent>/sse       → SSE legacy (fallback)
 *  POST /mcp/<agent>/messages  → mensajes SSE legacy
 */
function mountMcpAgent(agentKey, createServer) {

  // ── Streamable HTTP stateless (cada request es independiente) ───────────────
  // Sin auth middleware: ElevenLabs no envía headers custom en tool calls
  router.all(`/${agentKey}`, async (req, res) => {
    try {
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      logger.info(`[MCP:${agentKey}] HTTP request handled`, { method: req.body?.method });
    } catch (err) {
      logger.error(`[MCP:${agentKey}] HTTP error`, { error: err.message });
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });

  // ── SSE legacy (fallback para clientes que usen tipo SSE) ──────────────────
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

  router.post(`/${agentKey}/messages`, validateEnrichmentAgent, async (req, res) => {
    const { sessionId } = req.query;
    const transport = activeTransports[agentKey].get(sessionId);
    if (!transport) {
      logger.warn(`[MCP:${agentKey}] SSE session not found`, { sessionId });
      return res.status(404).json({ error: "Session not found" });
    }
    try {
      await transport.handlePostMessage(req, res, req.body);
    } catch (err) {
      logger.error(`[MCP:${agentKey}] SSE message error`, { error: err.message });
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });
}

mountMcpAgent("discovery", createDiscoveryServer);
mountMcpAgent("activation", createActivationServer);
mountMcpAgent("qualification", createQualificationServer);
mountMcpAgent("conversion", createConversionServer);

module.exports = router;
