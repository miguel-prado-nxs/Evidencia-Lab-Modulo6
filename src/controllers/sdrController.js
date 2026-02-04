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
const { enqueueSync } = require("../services/twenty/twentySyncService");

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
            userId,  // ID del usuario que inició la llamada (para asignación de prospecto)
            agentConfigId,  // ID de la configuración del agente usada (Agent Builder)
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

        // ===== Calcular attemptNumber real desde sdr_interactions =====
        const sdrInteractionsService = require("../services/sdrInteractionsService");
        const previousAttempts = await sdrInteractionsService.countAttempts(establishmentId);
        const attemptNumber = previousAttempts + 1;

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
            callAttempts: attemptNumber,
            callDurationSeconds: callDurationSeconds || 0,
            callStatus: callStatus,
            enrichmentStatus: enrichmentStatus,
            bestCallTime: bestCallTime || null,

            // Metadata.
            enrichedAt: new Date(),
            updatedAt: new Date(),
        };

        // ===== IMPORTANTE: Solo asignar enrichedBy en registros NUEVOS =====
        // Si el registro ya existe (ej: alguien lo agregó a contactos), 
        // NO cambiar el enrichedBy para mantener la asignación original
        if (!enrichment) {
            // Registro nuevo: usar userId si está disponible
            enrichmentData.enrichedBy = userId || "SDR Agent (sin usuario asignado)";
            enrichmentData.lastUpdatedBy = userId || "SDR Agent";
        } else {
            // Registro existente: solo actualizar lastUpdatedBy
            enrichmentData.lastUpdatedBy = userId || enrichment.enrichedBy || "SDR Agent";
        }

        // Agregar nota sobre origen SDR al callSummary si hay userId
        if (userId && callSummary) {
            enrichmentData.callSummary = `[SDR Agent] ${callSummary}`;
        }

        // ==================== LEVEL PROGRESSION ====================
        // Actualizar nivel según el estado del enriquecimiento y datos capturados
        // Siguiendo el funnel: ESTABLISHMENT → CONTACT → PROSPECT → LEAD → CLIENT

        // Si identificamos al tomador de decisiones, subimos a PROSPECT
        if (enrichmentStatus === "identified" && decisionMaker.name) {
            enrichmentData.level = "PROSPECT";
            logger.info(`[SDR Level] Establecimiento ${establishmentId} promovido a PROSPECT (tomador decisiones identificado)`);
        }
        // Si tenemos datos de callback pendiente, mantener al menos CONTACT
        else if (enrichmentStatus === "callback_scheduled" || enrichmentStatus === "contacted") {
            // Solo subir si actualmente es ESTABLISHMENT
            const currentLevel = enrichment?.level || "ESTABLISHMENT";
            if (currentLevel === "ESTABLISHMENT") {
                enrichmentData.level = "CONTACT";
                logger.info(`[SDR Level] Establecimiento ${establishmentId} promovido a CONTACT`);
            }
        }
        // Si es DNC o not_found, no cambiamos el nivel

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

        // ==================== GUARDAR EN SDR_INTERACTIONS ====================
        // Guardar historial de la llamada para métricas A/B
        try {
            await sdrInteractionsService.createInteraction({
                establishmentId,
                callStatus,
                enrichmentStatus,
                decisionMakerFound: !!decisionMaker?.name,
                decisionMakerName: decisionMaker?.name || null,
                decisionMakerRole: decisionMaker?.position || null,
                callSummary,
                callDurationSeconds,
                attemptNumber,  // Usar el valor calculado arriba
                strategy,
                gatekeeperInfo,
                twilioCallSid: null, // TODO: agregar si viene del agente
                agentConfigId,  // Referencia a la configuración del agente usada
            });
        } catch (interactionError) {
            // No bloquear el flujo principal si falla el guardado de interacción
            logger.error(`[SDR] Error guardando interacción: ${interactionError.message}`);
        }

        // ==================== TWENTY CRM SYNC (CONTACT LEVEL) ====================
        // Si se promovió a CONTACT (callback_scheduled o contacted), sincronizar con Twenty
        if (enrichmentData.level === "CONTACT" && userId) {
            enqueueSync({
                establishmentId: establishmentId,
                partnerId: userId,
                reason: "SDR_TO_CONTACT",
            }).catch((err) => {
                logger.warn("[SDR] Error encolando sync con Twenty para CONTACT (no critico)", { error: err.message });
            });
            logger.info(`[SDR] Sincronización con Twenty encolada para CONTACT ${establishmentId}`);
        }

        // ==================== LEAD PROSPECT CREATION ====================
        // Cuando se identifica un tomador de decisiones (PROSPECT), también debemos
        // crear/actualizar el registro en lead_prospects para que aparezca en "Mis Prospectos"
        // NOTA: establishmentId debe ser el clee (consistente con establishment_enrichments)
        if (enrichmentData.level === "PROSPECT" && userId) {
            try {
                // Verificar si ya existe un lead_prospect para este establecimiento (usa clee)
                let leadProspect = await prisma.leadProspect.findFirst({
                    where: { establishmentId: establishmentId },
                });

                if (leadProspect) {
                    // Actualizar si ya existe (asignar al usuario que hizo la llamada SDR)
                    leadProspect = await prisma.leadProspect.update({
                        where: { id: leadProspect.id },
                        data: {
                            partnerId: userId,  // userId es el salesPartnerId
                            status: "ASSIGNED",
                            assignedAt: new Date(),
                            notes: `Asignado por SDR Agent - Tomador de decisiones identificado: ${decisionMaker.name || 'N/A'}`,
                        },
                    });
                    logger.info(`[SDR] lead_prospect actualizado para ${establishmentId}, asignado a ${userId}`);
                } else {
                    // Crear nuevo lead_prospect
                    leadProspect = await prisma.leadProspect.create({
                        data: {
                            establishmentId: establishmentId,
                            partnerId: userId,  // userId es el salesPartnerId
                            status: "ASSIGNED",
                            assignedAt: new Date(),
                            notes: `Creado por SDR Agent - Tomador de decisiones identificado: ${decisionMaker.name || 'N/A'}`,
                        },
                    });
                    logger.info(`[SDR] lead_prospect creado para ${establishmentId}, asignado a ${userId}`);
                }

                // ==================== TWENTY CRM SYNC ====================
                // Encolar sincronización con Twenty CRM cuando se convierte a PROSPECT
                // Esto es crítico para mantener Twenty actualizado con los prospectos
                enqueueSync({
                    establishmentId: establishmentId,
                    partnerId: userId,
                    reason: "SDR_CONTACT_TO_PROSPECT",
                }).catch((err) => {
                    logger.warn("[SDR] Error encolando sync con Twenty (no critico)", { error: err.message });
                });
                logger.info(`[SDR] Sincronización con Twenty encolada para ${establishmentId}`);
            } catch (prospectError) {
                // No fallar todo el flujo si hay error creando lead_prospect
                logger.error(`[SDR] Error creando/actualizando lead_prospect: ${prospectError.message}`);
            }
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
    const sdrInteractionsService = require("../services/sdrInteractionsService");

    try {
        // Stats de enrichment (resultados finales)
        const enrichmentStats = await sdrService.getSDRStats();

        // Stats de interacciones (historial detallado con A/B)
        const interactionStats = await sdrInteractionsService.getStats();

        logger.info("SDR stats retrieved", {
            apiKey: req.apiKey?.name,
        });

        res.json({
            success: true,
            data: {
                enrichments: enrichmentStats,
                interactions: interactionStats,
            },
        });
    } catch (error) {
        logger.error("[SDR Controller] Error obteniendo stats:", error);
        next(error);
    }
}

/**
 * GET /api/v1/sdr/interactions/:establishmentId
 * Obtiene historial de interacciones SDR para un establecimiento.
 * 
 * @route GET /api/v1/sdr/interactions/:establishmentId
 * @access Privado (requiere API Key)
 */
async function getInteractions(req, res, next) {
    const sdrInteractionsService = require("../services/sdrInteractionsService");

    try {
        const { establishmentId } = req.params;

        if (!establishmentId) {
            return res.status(400).json({
                success: false,
                error: "establishmentId es requerido",
            });
        }

        const interactions = await sdrInteractionsService.getByEstablishment(establishmentId);

        res.json({
            success: true,
            data: {
                establishmentId,
                totalInteractions: interactions.length,
                interactions,
            },
        });
    } catch (error) {
        logger.error("[SDR Controller] Error obteniendo interacciones:", error);
        next(error);
    }
}

/**
 * GET /geo/ventas/sdr-calls/:establishmentId
 * Obtener información de llamadas SDR para un establecimiento
 */
async function getSDRCallInfo(req, res) {
    try {
        const { establishmentId } = req.params;

        if (!establishmentId) {
            return res.status(400).json({
                success: false,
                error: "establishmentId es requerido",
            });
        }

        const callInfo = await sdrService.getSDRCallInfo(establishmentId);

        if (!callInfo) {
            return res.json({
                success: true,
                data: null,
                message: "Sin llamadas registradas para este contacto",
            });
        }

        res.json({
            success: true,
            data: callInfo,
        });
    } catch (error) {
        logger.error("[VentasController] Error en getSDRCallInfo:", error);
        res.status(500).json({
            success: false,
            error: error.message || "Error obteniendo información de llamadas",
        });
    }
}


/**
 * POST /geo/ventas/sdr-calls/bulk
 * Obtener información de llamadas SDR para múltiples establecimientos
 */
async function getSDRCallInfoBulk(req, res) {
    try {
        const { establishmentIds } = req.body;

        if (!establishmentIds || !Array.isArray(establishmentIds)) {
            return res.status(400).json({
                success: false,
                data: {},
                error: "establishmentIds array es requerido",
            });
        }

        const callInfoMap = await sdrService.getSDRCallInfoBulk(establishmentIds);

        res.json({
            success: true,
            data: callInfoMap,
        });
    } catch (error) {
        logger.error("[VentasController] Error en getSDRCallInfoBulk:", error);
        res.status(500).json({
            success: false,
            error: error.message || "Error obteniendo información de llamadas bulk",
        });
    }
}

/**
 * GET /geo/ventas/lead-calls/:establishmentId
 * Obtener información de llamadas de calificación (call_leads) para un prospecto
 */
async function getLeadCallInfo(req, res) {
    try {
        const { establishmentId } = req.params;

        if (!establishmentId) {
            return res.status(400).json({
                success: false,
                error: "establishmentId es requerido",
            });
        }

        const callInfo = await sdrService.getLeadCallInfo(establishmentId);

        if (!callInfo) {
            return res.json({
                success: true,
                data: null,
                message: "Sin llamadas registradas para este prospecto",
            });
        }

        res.json({
            success: true,
            data: callInfo,
        });
    } catch (error) {
        logger.error("[VentasController] Error en getLeadCallInfo:", error);
        res.status(500).json({
            success: false,
            error: "Error obteniendo información de llamadas",
        });
    }
}


/**
 * GET /api/v1/sdr/stats/agent/:agentConfigId
 * Obtiene estadísticas específicas para una configuración de agente (para Demo Form Service)
 */
async function getAgentConfigStats(req, res, next) {
    const sdrInteractionsService = require("../services/sdrInteractionsService");
    try {
        const { agentConfigId } = req.params;
        const stats = await sdrInteractionsService.getAgentConfigStats(agentConfigId);
        res.json({ success: true, data: stats });
    } catch (error) {
        logger.error("[SDR Controller] Error getting agent config stats:", error);
        next(error);
    }
}

/**
 * GET /api/v1/sdr/stats/agents
 * Obtiene estadísticas de TODAS las configuraciones agrupadas (para Demo Form Service)
 */
async function getAllAgentConfigStats(req, res, next) {
    const sdrInteractionsService = require("../services/sdrInteractionsService");
    try {
        const { dateFrom, dateTo } = req.query;
        const stats = await sdrInteractionsService.getAllAgentConfigStats({ dateFrom, dateTo });
        res.json({ success: true, data: stats });
    } catch (error) {
        logger.error("[SDR Controller] Error getting all agent config stats:", error);
        next(error);
    }
}
module.exports = {
    handleCallResult,
    getEstablishmentForCall,
    getStats,
    getInteractions,
    getSDRCallInfo,
    getSDRCallInfoBulk,
    getLeadCallInfo,
    getAgentConfigStats,
    getAllAgentConfigStats,
};