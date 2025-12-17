const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

/**
 * Maneja el resultado de una llamada SDR.
 * Guarda información del tomador de decisiones y resultado de la llamada.
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
            console.log(`[SDR TEST MODE] Procesando ID de prueba: ${establishmentId}`);
            
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

        // Buscar establecimiento en Mapa DB.
        // NOTA: Como establishmentId es referencia a otra DB, NO podemos hacer
        // FK constraint. Asumimos que el ID es válido si viene del agente.
        // En producción, aquí harías una llamada a Mapa API para validar.

        // Buscar enriquecimiento existente.
        let enrichment = await prisma.establishmentEnrichment.findUnique({
            where: { establishmentId: establishmentId },
        });

        // Preparar datos para upsert.
        const enrichmentData = {
            // Actualizar solo si hay nuevos datos.
            ...(decisionMaker.name && { decisionMakerName: decisionMaker.name }),
            ...(decisionMaker.position && { decisionMakerPosition: decisionMaker.position }),
            ...(decisionMaker.phone && { decisionMakerPhone: decisionMaker.phone }),
            ...(decisionMaker.whatsapp && { decisionMakerWhatsApp: decisionMaker.whatsapp }),
            ...(decisionMaker.email && { decisionMakerEmail: decisionMaker.email }),
            
            // Campos SDR (siempre actualizar).
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

        return res.status(201).json({
            success: true,
            message: "Call result guardado exitosamente",
            enrichment: enrichment,
        });
    } catch (error) {
        console.error("[SDR Controller] Error guardando call result:", error);
        
        // Prisma error handling.
        if (error.code === "P2002") {
            return res.status(409).json({
                success: false,
                error: "Ya existe un enriquecimiento para este establecimiento",
            });
        }
        
        next(error);
    }
}

module.exports = {
    handleCallResult,
};