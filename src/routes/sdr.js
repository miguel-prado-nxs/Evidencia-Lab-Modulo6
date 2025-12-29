/**
 * SDR Agent Routes
 * Rutas para la API del Agente SDR (agentes-crm-sdk)
 * 
 * Autenticación: X-Enrichment-Agent-Key header
 */

const express = require("express");
const router = express.Router();
const sdrController = require("../controllers/sdrController");
const { validateEnrichmentAgent } = require("../middleware/enrichmentAgent");

// Todas las rutas SDR requieren Enrichment Agent Key
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

module.exports = router;
