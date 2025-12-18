/**
 * SDR Controller
 * Controlador para endpoints del Agente SDR
 * 
 * Recibe llamadas desde agentes-crm-sdk para:
 * - Reportar resultados de llamadas de calificación
 * - Obtener contexto de establecimientos antes de llamar
 * - Obtener estadísticas de rendimiento SDR
 */

const { PrismaClient } = require("@prisma/client");
const sdrService = require("../services/sdrService");
const logger = require("../config/logger");

const prisma = new PrismaClient();

/**
 * POST /api/v1/sdr/call-result
 * Recibe resultado de llamada SDR desde agentes-crm-sdk.
 * 
 * @route POST /api/v1/sdr/call-result
 * @access Privado (requiere API Key)
 */
async function handleCallResult(req, res, next) {
    try {
        const {
            establishmentId,
            callStatus,
            enrichmentStatus,
            decisionMaker = {},
            gatekeeperInfo = {},
            callSummary,
            strategy,
            callAttempts,
            callDurationSeconds,
            bestCallTime,
        } = req.body;

        // Validación básica.
        if (!establishmentId) {
            return res.status(400).json({
                success: false,
                error: "establishmentId es requerido",
            });
        }

        // Validar enrichmentStatus.
        const validEnrichmentStatuses = [
            "contacted",
            "identified",
            "callback_scheduled",
            "not_found",
            "gatekeeper_blocked",
            "dnc",
        ];
        if (enrichmentStatus && !validEnrichmentStatuses.includes(enrichmentStatus)) {
            return res.status(400).json({
                success: false,
                error: `enrichmentStatus inválido. Valores válidos: ${validEnrichmentStatuses.join(", ")}`,
            });
        }

        // Validar callStatus.
        const validCallStatuses = ["completed", "no_answer", "voicemail", "failed"];
        if (callStatus && !validCallStatuses.includes(callStatus)) {
            return res.status(400).json({
                success: false,
                error: `callStatus inválido. Valores válidos: ${validCallStatuses.join(", ")}`,
            });
        }

        // Validar strategy.
        const validStrategies = ["A", "B", "N/A"];
        if (strategy && !validStrategies.includes(strategy)) {
            return res.status(400).json({
                success: false,
                error: `strategy inválido. Valores válidos: ${validStrategies.join(", ")}`,
            });
        }

        // Test Mode: permitir IDs de prueba en development.
        const isTestId = establishmentId.startsWith("test-");
        if (process.env.NODE_ENV === "development" && isTestId) {
            logger.info(`[SDR TEST MODE] Procesando ID de prueba: ${establishmentId}`, {
                apiKey: req.apiKey?.name,
            });
            
            return res.status(201).json({
                success: true,
                message: "Call result guardado exitosamente (TEST MODE)",
                enrichment: {
                    id: `enrichment-test-${Date.now()}`,
                    establishment_id: establishmentId,
                    decision_maker_name: decisionMaker.name || null,
                    decision_maker_position: decisionMaker.position || null,
                    decision_maker_phone: decisionMaker.phone || null,
                    decision_maker_email: decisionMaker.email || null,
                    gatekeeper_name: gatekeeperInfo.name || null,
                    gatekeeper_info: gatekeeperInfo,
                    call_summary: callSummary,
                    strategy: strategy,
                    call_attempts: callAttempts || 1,
                    call_duration_seconds: callDurationSeconds || 0,
                    call_status: callStatus,
                    enrichment_status: enrichmentStatus,
                    best_call_time: bestCallTime || null,
                    enriched_by: "SDR Agent",
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                },
            });
        }

        // Buscar enriquecimiento existente.
        let enrichment = await prisma.establishmentEnrichment.findUnique({
            where: { establishmentId: establishmentId },
        });

        // Preparar datos para upsert (usa nuevas columnas de migración).
        const enrichmentData = {
            // Decision Maker fields (solo actualizar si hay nuevos datos).
            ...(decisionMaker.name && { decisionMakerName: decisionMaker.name }),
            ...(decisionMaker.position && { decisionMakerPosition: decisionMaker.position }),
            ...(decisionMaker.phone && { decisionMakerPhone: decisionMaker.phone }),
            ...(decisionMaker.whatsapp && { decisionMakerWhatsApp: decisionMaker.whatsapp }),
            ...(decisionMaker.email && { decisionMakerEmail: decisionMaker.email }),
            
            // Campos SDR (siempre actualizar con nuevas columnas de migración).
            gatekeeperInfo: gatekeeperInfo && Object.keys(gatekeeperInfo).length > 0 
                ? gatekeeperInfo 
                : null,
            callSummary: callSummary,
            strategy: strategy,
            callAttempts: callAttempts || 1,
            callDurationSeconds: callDurationSeconds || 0,
            callStatus: callStatus,
            enrichmentStatus: enrichmentStatus,
            bestCallTime: bestCallTime || null,
            
            // Metadata.
            enrichedBy: "SDR Agent",
            enrichedAt: new Date(),
            lastUpdatedBy: "SDR Agent",
            updatedAt: new Date(),
        };

        if (enrichment) {
            // Actualizar enriquecimiento existente.
            enrichment = await prisma.establishmentEnrichment.update({
                where: { id: enrichment.id },
                data: enrichmentData,
            });
        } else {
            // Crear nuevo enriquecimiento.
            enrichment = await prisma.establishmentEnrichment.create({
                data: {
                    establishmentId: establishmentId,
                    ...enrichmentData,
                },
            });
        }

        logger.info(`SDR call result saved for ${establishmentId}`, {
            apiKey: req.apiKey?.name,
            status: callStatus,
            enrichmentStatus: enrichmentStatus,
        });

        return res.status(201).json({
            success: true,
            message: "Call result guardado exitosamente",
            enrichment: enrichment,
        });
    } catch (error) {
        logger.error("[SDR Controller] Error guardando call result:", error);
        
        // Prisma error handling.
        if (error.code === "P2002") {
            return res.status(409).json({
                success: false,
                error: "Ya existe un enriquecimiento para este establecimiento",
            });
        }
        
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
 * Obtiene datos del establecimiento para contexto del agente SDR.
 * 
 * @route GET /api/v1/sdr/establishment/:id
 * @access Privado (requiere API Key)
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

        logger.info(`SDR establishment data retrieved for ${id}`, {
            apiKey: req.apiKey?.name,
        });

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
 * Obtiene estadísticas de SDR para dashboard.
 * 
 * @route GET /api/v1/sdr/stats
 * @access Privado (requiere API Key)
 */
async function getStats(req, res, next) {
    try {
        const stats = await sdrService.getSDRStats();

        logger.info("SDR stats retrieved", {
            apiKey: req.apiKey?.name,
        });

        res.json({
            success: true,
            data: stats,
        });
    } catch (error) {
        logger.error("[SDR Controller] Error obteniendo stats:", error);
        next(error);
    }
}

module.exports = {
    handleCallResult,
    getEstablishmentForCall,
    getStats,
};