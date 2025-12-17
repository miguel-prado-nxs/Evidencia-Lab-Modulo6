/**
 * SDR Controller
 * Controlador para endpoints del Agente SDR
 * 
 * Recibe llamadas desde agentes-crm-sdk para:
 * - Reportar resultados de llamadas de calificación
 * - Obtener contexto de establecimientos antes de llamar
 */

const sdrService = require("../services/sdrService");
const logger = require("../config/logger");

/**
 * POST /api/v1/sdr/call-result
 * Recibe resultado de llamada SDR desde agentes-crm-sdk
 */
async function handleCallResult(req, res, next) {
    try {
        const {
            establishmentId,
            decisionMaker,
            enrichmentStatus,
            callSummary,
            gatekeeperInfo,
            strategy,
            callAttempts,
            callDurationSeconds,
            callStatus,
        } = req.body;

        // Validación básica
        if (!establishmentId) {
            return res.status(400).json({
                success: false,
                error: "establishmentId es requerido",
            });
        }

        // VALIDACIÓN DE enrichmentStatus
        const validStatuses = [
            "contacted",
            "identified",
            "callback_scheduled",
            "not_found",
            "gatekeeper_blocked",
            "dnc"  
        ];

        if (enrichmentStatus && !validStatuses.includes(enrichmentStatus)) {
            return res.status(400).json({
                success: false,
                error: `enrichmentStatus inválido. Valores válidos: ${validStatuses.join(", ")}`,
            });
        }

        // Guardar resultado
        const enrichment = await sdrService.saveCallResult(establishmentId, {
            decisionMaker,
            enrichmentStatus,
            callSummary,
            gatekeeperInfo,
            strategy,
            callAttempts,
            callDurationSeconds,
            callStatus,
        });

        logger.info(`SDR call result received for ${establishmentId}`, {
            apiKey: req.apiKey?.name,
            status: callStatus,
        });

        res.json({
            success: true,
            enrichment,
        });
    } catch (error) {
        if (error.message === "Establecimiento no encontrado") {
            return res.status(404).json({
                success: false,
                error: error.message,
            });
        }
        next(error);
    }
}

/**
 * GET /api/v1/sdr/establishment/:id
 * Obtiene datos del establecimiento para contexto del agente SDR
 */
async function getEstablishmentForCall(req, res, next) {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                success: false,
                error: "ID de establecimiento requerido",
            });
        }

        const data = await sdrService.getEstablishmentForCall(id);

        res.json({
            success: true,
            data,
        });
    } catch (error) {
        if (error.message === "Establecimiento no encontrado") {
            return res.status(404).json({
                success: false,
                error: error.message,
            });
        }
        next(error);
    }
}

/**
 * GET /api/v1/sdr/stats
 * Obtiene estadísticas de SDR para dashboard
 */
async function getStats(req, res, next) {
    try {
        const stats = await sdrService.getSDRStats();

        res.json({
            success: true,
            data: stats,
        });
    } catch (error) {
        next(error);
    }
}

module.exports = {
    handleCallResult,
    getEstablishmentForCall,
    getStats,
};
