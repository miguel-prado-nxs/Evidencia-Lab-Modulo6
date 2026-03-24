const express = require('express');
const router = express.Router();
const elevenLabsService = require('../services/elevenLabsService');
const logger = require('../config/logger');
// Si tienes un middleware de autenticación, agrégalo aquí, e.g. require('../middlewares/auth');

/**
 * GET /api/v1/elevenlabs/agents
 * Proxy para obtener la lista de Agentes de ElevenLabs
 */
router.get('/agents', async (req, res) => {
    try {
        const data = await elevenLabsService.getAgents();
        res.json({ success: true, data });
    } catch (error) {
        logger.error('Route /agents error:', error.message);
        res.status(500).json({ success: false, error: 'Error al obtener agentes de ElevenLabs' });
    }
});

/**
 * GET /api/v1/elevenlabs/voices
 * Proxy para obtener la lista de Voces de ElevenLabs
 */
router.get('/voices', async (req, res) => {
    try {
        const data = await elevenLabsService.getVoices();
        res.json({ success: true, data });
    } catch (error) {
        logger.error('Route /voices error:', error.message);
        res.status(500).json({ success: false, error: 'Error al obtener voces de ElevenLabs' });
    }
});

module.exports = router;
