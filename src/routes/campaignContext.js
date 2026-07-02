const express = require('express');
const router = express.Router();
const campaignContextController = require('../controllers/campaignContextController');

/**
 * GET /api/v1/campaign-context?campaignId=uuid&campaignContactId=uuid
 * Obtiene el contexto completo de la campaña para ElevenLabs
 */
router.get('/', campaignContextController.getCampaignContext);

/**
 * GET /api/v1/campaign-context/coupon-instructions?campaignId=uuid
 * Obtiene las instrucciones de cupones para el agente
 */
router.get('/coupon-instructions', campaignContextController.getCouponInstructions);

/**
 * GET /api/v1/campaign-context/coupon-templates?campaignId=uuid
 * Obtiene los templates de cupones disponibles
 */
router.get('/coupon-templates', campaignContextController.getCouponTemplates);

module.exports = router;
