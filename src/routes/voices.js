const express = require('express');
const router = express.Router();
const voicesController = require('../controllers/voicesController');
const { authenticateJWTOrServiceKey } = require('../middleware/auth');

// Listar todas las voces activas
router.get('/', authenticateJWTOrServiceKey, voicesController.listVoices);

// Obtener una voz por ID
router.get('/:id', authenticateJWTOrServiceKey, voicesController.getVoiceById);

module.exports = router;
