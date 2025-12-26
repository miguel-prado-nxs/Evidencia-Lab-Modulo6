/**
 * Qualification Routes
 * Rutas para el Agente de Calificación (BANT)
 */

const express = require("express");
const router = express.Router();
const qualificationController = require("../controllers/qualificationController");
const { authenticateApiKey } = require("../middleware/auth");
const { validateEnrichmentAgent } = require("../middleware/enrichmentAgent");

// POST /api/v1/qualification/call-result - Crea nuevo registro de llamada
// Requiere autenticación con X-Enrichment-Agent-Key
router.post("/call-result", validateEnrichmentAgent, qualificationController.handleCallResult);

// PATCH /api/v1/qualification/call-result - Actualiza registro existente
// Requiere autenticación con X-Enrichment-Agent-Key
router.patch("/call-result", validateEnrichmentAgent, qualificationController.handleCallResult);

// GET /api/v1/qualification/stats - Estadísticas de calificación (requiere API Key)
router.get("/stats", authenticateApiKey, qualificationController.getStats);

module.exports = router;
