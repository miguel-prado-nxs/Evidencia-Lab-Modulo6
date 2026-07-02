/**
 * Export Routes
 * Rutas para la exportación de datos
 */

const express = require('express');
const router = express.Router();
const exportController = require('../controllers/exportController');
const { authenticateJWT, requireAdmin } = require('../middleware/auth');

// Todas las rutas requieren autenticación
router.use(authenticateJWT);

// Exportar leads (partner ve los suyos, admin ve todos)
router.get('/leads', exportController.exportLeads);

// Exportar deals
router.get('/deals', exportController.exportDeals);

// Exportar comisiones
router.get('/commissions', exportController.exportCommissions);

// Exportar partners (admin only)
router.get('/partners', requireAdmin, exportController.exportPartners);

// Generar reporte de partner
router.get('/report/:partnerId', exportController.generatePartnerReport);

// Exportar para ElevenLabs Batch (NUEVO)
router.get('/elevenlabs', exportController.exportLeadsForElevenLabs);

module.exports = router;
