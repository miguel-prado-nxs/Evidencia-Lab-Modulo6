const express = require("express");
const { randomUUID } = require("crypto");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { SSEServerTransport } = require("@modelcontextprotocol/sdk/server/sse.js");
const { validateEnrichmentAgent } = require("../middleware/enrichmentAgent");
const { createDiscoveryServer } = require("../mcp/discoveryMcp");
const { createActivationServer } = require("../mcp/activationMcp");
const { createQualificationServer } = require("../mcp/qualificationMcp");
const { createConversionServer } = require("../mcp/conversionMcp");
const logger = require("../config/logger");

const router = express.Router();

// Sessions for Streamable HTTP (stateful)
const httpSessions = new Map(); // sessionId -> { server, transport }

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

  // ── Streamable HTTP (POST único, soporta sesiones y stateless) ──────────────
  router.all(`/${agentKey}`, validateEnrichmentAgent, async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"];

      // Reutilizar sesión existente
      if (sessionId && httpSessions.has(sessionId)) {
        const { transport } = httpSessions.get(sessionId);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // Nueva sesión (initialize) o stateless
      const isInit =
        req.method === "POST" &&
        req.body?.method === "initialize";

      if (req.method === "POST" && !isInit && sessionId) {
        logger.warn(`[MCP:${agentKey}] Session not found`, { sessionId });
        return res.status(404).json({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null });
      }

      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          httpSessions.set(sid, { server, transport });
          logger.info(`[MCP:${agentKey}] HTTP session initialized`, { sessionId: sid });
          // Limpiar sesión tras 30 min de inactividad
          setTimeout(() => {
            httpSessions.delete(sid);
            logger.info(`[MCP:${agentKey}] HTTP session expired`, { sessionId: sid });
          }, 30 * 60 * 1000);
        },
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      logger.info(`[MCP:${agentKey}] Streamable HTTP request handled`);
    } catch (err) {
      logger.error(`[MCP:${agentKey}] Streamable HTTP error`, { error: err.message });
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
