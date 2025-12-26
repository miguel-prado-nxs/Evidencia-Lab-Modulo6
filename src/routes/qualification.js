/**
 * Qualification Routes
 * Rutas para el Agente de Calificación (BANT)
 */

const express = require("express");
const router = express.Router();
const qualificationController = require("../controllers/qualificationController");
const { authenticateApiKey } = require("../middleware/auth");

// POST /api/v1/qualification/call-result - Crea nuevo registro de llamada
// Este endpoint es un webhook y no requiere autenticación API Key
router.post("/call-result", qualificationController.handleCallResult);

// PATCH /api/v1/qualification/call-result - Actualiza registro existente
// Usado por save_qualification_result del SDK para agregar datos de calificación
router.patch("/call-result", qualificationController.handleCallResult);

// GET /api/v1/qualification/stats - Estadísticas de calificación (requiere API Key)
router.get("/stats", authenticateApiKey, qualificationController.getStats);

module.exports = router;
