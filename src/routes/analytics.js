const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { authenticateJWT, requireAdmin } = require('../middleware/auth');

// Todas las rutas requieren autenticación
router.use(authenticateJWT);

// Dashboard global (admin)
router.get('/dashboard', requireAdmin, analyticsController.getDashboard);

// Análisis por campañas (admin)
router.get('/campaigns', requireAdmin, analyticsController.getCampaigns);

// Top partners (admin)
router.get('/top-partners', requireAdmin, analyticsController.getTopPartners);

// Tendencias (admin)
router.get('/trends', requireAdmin, analyticsController.getTrends);

// Embudo (todos pueden ver el suyo, admin puede ver todos)
router.get('/funnel', analyticsController.getFunnel);

// KPIs del programa (admin)
router.get('/kpis', requireAdmin, analyticsController.getKPIs);

module.exports = router;
