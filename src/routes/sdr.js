/**
 * SDR Agent Routes
 * Rutas para la API del Agente SDR (agentes-crm-sdk)
 * 
 * Autenticación: X-Enrichment-Agent-Key header
 */

const express = require("express");
const router = express.Router();
const sdrController = require("../controllers/sdrController");
const { authenticateJWT, authenticateJWTOrServiceKey, optionalAuth, requireAdmin, requireVentasAdmin } = require("../middleware/auth");
const { validateEnrichmentAgent } = require("../middleware/enrichmentAgent");

/**
 * GET /api/v1/sdr/establishment/sdr-calls/:establishmentId
 * Obtener información de llamadas SDR para un establecimiento (para ventas)
 * Muestra el historial de interacciones del agente SDR con el contacto
 * Esta ruta NO requiere Enrichment Agent Key, usa JWT o Service Key
 */
router.get("/establishment/sdr-calls/:establishmentId", authenticateJWTOrServiceKey, sdrController.getSDRCallInfo);

/**
 * GET /api/v1/geo/ventas/lead-calls/:establishmentId
 * Obtener información de llamadas de calificación para un prospecto
 * Muestra el historial de llamadas y calificación BANT del prospecto
 */
router.get("/establishment/lead-calls/:establishmentId", authenticateJWTOrServiceKey, sdrController.getLeadCallInfo);

/**
 * GET /api/v1/sdr/stats/agents
 * Obtener estadísticas de TODAS las configuraciones agrupadas
 * Utilizado por Demo Form Service
 */
router.get("/stats/agents", optionalAuth, sdrController.getAllAgentConfigStats);

/**
 * GET /api/v1/sdr/stats/agent/:agentConfigId
 * Obtener estadísticas filtradas por configuración de agente
 * Utilizado por Demo Form Service
 */
router.get("/stats/agent/:agentConfigId", optionalAuth, sdrController.getAgentConfigStats);

// ============================================
// Todas las rutas siguientes requieren Enrichment Agent Key
// ============================================
router.use(validateEnrichmentAgent);

/**
 * POST /api/v1/sdr/call-result
 * Recibe resultado de llamada SDR
 * 
 * Body: {
 *   establishmentId: string,
 *   callStatus: "completed" | "no_answer" | "voicemail" | "failed",
 *   decisionMaker: {
 *     name: string,
 *     position: "dueno" | "gerente" | "encargado" | "administrador" | "socio" | "otro",
 *     phone: string,
 *     whatsapp: string,
 *     email: string
 *   },
 *   enrichmentStatus: "contacted" | "identified" | "callback_scheduled" | "not_found" | "gatekeeper_blocked",
 *   callSummary: string,
 *   gatekeeperInfo: {
 *     name: string,
 *     infoObtained: string[]
 *   },
 *   strategy: "A" | "B",
 *   callAttempts: number,
 *   callDurationSeconds: number
 * }
 */
router.post("/call-result", sdrController.handleCallResult);

/**
 * GET /api/v1/sdr/establishment/:id
 * Obtiene datos del establecimiento para contexto del agente
 * 
 * Returns: {
 *   establishment: { ... datos DENUE ... },
 *   enrichment: { ... datos enriquecidos si existen ... },
 *   sdrContext: {
 *     recommendedStrategy: "A" | "B",
 *     hasExistingDecisionMaker: boolean,
 *     previousAttempts: number
 *   }
 * }
 */
router.get("/establishment/:id", sdrController.getEstablishmentForCall);

/**
 * GET /api/v1/sdr/stats
 * Obtiene estadísticas de SDR para dashboard
 */
router.get("/stats", sdrController.getStats);

/**
 * GET /api/v1/sdr/interactions/:establishmentId
 * Obtiene historial de interacciones SDR para un establecimiento
 */
router.get("/interactions/:establishmentId", sdrController.getInteractions);

module.exports = router;
