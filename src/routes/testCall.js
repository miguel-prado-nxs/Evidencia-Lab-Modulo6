/**
 * Test Call Routes
 * Rutas para llamadas de prueba de configuraciones de agentes
 *  
 * Autenticación: Opcional (funciona mejor con auth para logging)
 */

const express = require("express");
const router = express.Router();
const testCallController = require("../controllers/testCallController");
const { optionalAuth } = require("../middleware/auth");

/**
 * POST /api/v1/test-call
 * Realiza una llamada de prueba con la configuración del agente
 * 
 * Body: {
 *   phone: string,
 *   message: string,
 *   model_settings: {
 *     voice: string,
 *     speed: number,
 *     style?: string,
 *     pitch?: number,
 *     intensity?: number,
 *     turn_detection: { type: string },
 *     age?: number,
 *     origin?: string,
 *     personality_name?: string,
 *     personality_description?: string,
 *     tone_description?: string,
 *     inner_voice?: string,
 *     expressions?: string[],
 *     imperfections?: string,
 *     transparency_response?: string
 *   }
 * }
 * 
 * Autenticación opcional (mejora logging si se proporciona)
 */
router.post("/", optionalAuth, testCallController.handleTestCall);

module.exports = router;
