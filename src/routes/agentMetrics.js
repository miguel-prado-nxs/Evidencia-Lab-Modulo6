const express = require('express');
const router = express.Router();
const agentMetricsController = require('../controllers/agentMetricsController');

// API Key middleware for agent metrics
const validateApiKey = (req, res, next) => {
    const apiKey = process.env.SDR_API_KEY;

    if (!apiKey) {
        console.warn('SDR_API_KEY not set - skipping API key validation');
        return next();
    }

    const providedKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');

    if (!providedKey) {
        return res.status(401).json({
            success: false,
            error: 'API key required. Provide X-API-Key header.',
        });
    }

    if (providedKey !== apiKey) {
        return res.status(403).json({
            success: false,
            error: 'Invalid API key',
        });
    }

    next();
};

// Apply API key validation
router.use(validateApiKey);

// GET /api/agent-metrics - Métricas agregadas por config
router.get('/', agentMetricsController.getAgentMetrics);

// GET /api/agent-metrics/:configId - Métricas detalladas de una config
router.get('/:configId', agentMetricsController.getConfigMetrics);

module.exports = router;
