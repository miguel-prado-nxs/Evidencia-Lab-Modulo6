const express = require('express');
const referralsController = require('../controllers/referralsController');
const { authenticateJWT } = require('../middleware/auth');

const router = express.Router();

// Todas las rutas requieren autenticación
router.use(authenticateJWT);

// Información básica del referido (código y link base)
router.get('/info', referralsController.getInfo);

// Estadísticas generales del link de referido
router.get('/stats', referralsController.getStats);

// CRUD de campañas UTM
router.get('/campaigns', referralsController.listCampaigns);
router.post('/campaigns', referralsController.createCampaign);
router.get('/campaigns/:id', referralsController.getCampaign);
router.delete('/campaigns/:id', referralsController.deleteCampaign);

module.exports = router;
