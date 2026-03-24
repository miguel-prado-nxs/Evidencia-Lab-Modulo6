/**
 * Webhook Routes
 * 
 * Rutas para recibir webhooks de servicios externos.
 * No requieren autenticación JWT/API Key propia — se validan
 * con la firma del servicio que envía (ElevenLabs).
 */

const express = require("express");
const router = express.Router();
const elevenLabsWebhookController = require("../controllers/elevenLabsWebhookController");

// ElevenLabs call completion webhook
router.post("/elevenlabs/call-completed", elevenLabsWebhookController.handleCallCompleted);

// Health check
router.get("/elevenlabs/health", elevenLabsWebhookController.webhookHealth);

module.exports = router;
