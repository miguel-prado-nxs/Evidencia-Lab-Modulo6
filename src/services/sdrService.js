/**
 * SDR Service
 * Servicios para el Agente SDR de identificación de tomadores de decisiones
 * 
 * El SDR Agent desde agentes-crm-sdk llama a estos endpoints para:
 * - Guardar resultados de llamadas
 * - Actualizar información del tomador de decisiones
 * - Registrar interacciones con gatekeepers
 */

const prisma = require("../config/database");
const prismaGeo = require("../config/database-geo");
const logger = require("../config/logger");
const enrichmentService = require("./enrichmentService");

/**
 * Guardar resultado de llamada SDR
 * Actualiza el enriquecimiento del establecimiento con info del tomador de decisiones
 * 
 * @param {string} establishmentId - ID del establecimiento en Mapa DB
 * @param {Object} data - Datos de la llamada
 * @returns {Object} - Enriquecimiento actualizado
 */
async function saveCallResult(establishmentId, data) {
    try {
        const {
            decisionMaker,
            enrichmentStatus,
            callSummary,
            gatekeeperInfo,
            strategy,
            callAttempts,
            callDurationSeconds,
            callStatus,
        } = data;

        // Preparar datos de enriquecimiento
        const enrichmentData = {};

        // Datos del tomador de decisiones
        if (decisionMaker) {
            if (decisionMaker.name) {
                enrichmentData.decisionMakerName = decisionMaker.name;
            }
            if (decisionMaker.position) {
                enrichmentData.decisionMakerPosition = decisionMaker.position;
            }
            if (decisionMaker.phone) {
                enrichmentData.decisionMakerPhone = decisionMaker.phone;
            }
            if (decisionMaker.whatsapp) {
                enrichmentData.decisionMakerWhatsApp = decisionMaker.whatsapp;
            }
            if (decisionMaker.email) {
                enrichmentData.decisionMakerEmail = decisionMaker.email;
            }
        }

        // Usar el enrichmentService existente para crear/actualizar
        // Nota: partnerId es null porque es el agente SDR, no un partner específico
        const enrichment = await enrichmentService.createOrUpdateEnrichment(
            establishmentId,
            enrichmentData,
            null // Sin partnerId específico - es el agente SDR
        );

        // Registrar la interacción SDR como metadatos adicionales
        await logSDRInteraction(establishmentId, {
            callStatus,
            enrichmentStatus,
            callSummary,
            gatekeeperInfo,
            strategy,
            callAttempts,
            callDurationSeconds,
            timestamp: new Date(),
        });

        logger.info(`SDR call result saved for establishment ${establishmentId}`, {
            status: enrichmentStatus,
            decisionMakerIdentified: !!decisionMaker?.name,
            strategy,
        });

        return enrichment;
    } catch (error) {
        logger.error("Error saving SDR call result:", error);
        throw error;
    }
}

/**
 * Registrar interacción SDR
 * Guarda en sdr_interactions y actualiza campos en establishment_enrichments
 * 
 * @param {string} establishmentId - ID del establecimiento
 * @param {Object} interactionData - Datos de la interacción
 */
async function logSDRInteraction(establishmentId, interactionData) {
    const sdrInteractionsService = require("./sdrInteractionsService");

    try {
        const {
            callStatus,
            enrichmentStatus,
            callSummary,
            gatekeeperInfo,
            strategy,
            callAttempts,
            callDurationSeconds,
            decisionMaker,
            twilioCallSid,
        } = interactionData;

        // 1. Contar intentos previos para este establecimiento
        const previousAttempts = await sdrInteractionsService.countAttempts(establishmentId);
        const attemptNumber = previousAttempts + 1;

        // 2. Guardar en sdr_interactions (historial completo)
        await sdrInteractionsService.createInteraction({
            establishmentId,
            callStatus,
            enrichmentStatus,
            decisionMakerFound: !!decisionMaker?.name,
            decisionMakerName: decisionMaker?.name || null,
            decisionMakerRole: decisionMaker?.position || null,
            callSummary,
            callDurationSeconds,
            attemptNumber,
            strategy,
            gatekeeperInfo,
            twilioCallSid,
        });

        // 3. Actualizar campos agregados en establishment_enrichments
        await prisma.establishmentEnrichment.updateMany({
            where: { establishmentId },
            data: {
                callAttempts: attemptNumber,
                callDurationSeconds: callDurationSeconds || 0,
                callStatus,
                enrichmentStatus,
                strategy,
                gatekeeperInfo,
                callSummary,
            },
        });

        logger.info(`SDR Interaction logged for ${establishmentId}`, {
            attemptNumber,
            callStatus,
            enrichmentStatus,
            decisionMakerFound: !!decisionMaker?.name,
        });

        return true;
    } catch (error) {
        logger.error("Error logging SDR interaction:", error);
        // No lanzar error - el logging no debe bloquear el flujo principal
        return false;
    }
}

/**
 * Obtener establecimiento para contexto del agente SDR
 * Devuelve datos necesarios para que el agente sepa cómo manejar la llamada
 * 
 * @param {string} establishmentId - ID del establecimiento
 * @returns {Object} - Datos del establecimiento con contexto SDR
 */
async function getEstablishmentForCall(establishmentId) {
    try {
        // Obtener establecimiento de Mapa DB
        const establishment = await prismaGeo.establishment.findUnique({
            where: { id: establishmentId },
            select: {
                id: true,
                name: true,
                phone: true,
                email: true,
                website: true,
                activityName: true,
                employeeRange: true,
                stateName: true,
                municipalityName: true,
                neighborhood: true,
            },
        });

        if (!establishment) {
            throw new Error("Establecimiento no encontrado");
        }

        // Obtener enriquecimiento existente si hay
        const enrichment = await prisma.establishmentEnrichment.findUnique({
            where: { establishmentId },
        });

        // Determinar estrategia recomendada basada en tamaño
        const recommendedStrategy = getRecommendedStrategy(establishment.employeeRange);

        return {
            establishment,
            enrichment: enrichment || null,
            sdrContext: {
                recommendedStrategy,
                hasExistingDecisionMaker: !!enrichment?.decisionMakerName,
                previousAttempts: 0, // TODO: obtener de sdr_interactions
            },
        };
    } catch (error) {
        logger.error("Error getting establishment for SDR call:", error);
        throw error;
    }
}

/**
 * Determinar estrategia recomendada basada en tamaño del negocio
 * - Estrategia A: Directo con valor (negocios pequeños 0-5 empleados)
 * - Estrategia B: Referencia interna (negocios grandes 6+ empleados)
 */
function getRecommendedStrategy(employeeRange) {
    const smallBusiness = ["0 a 5 personas"];

    if (smallBusiness.includes(employeeRange)) {
        return "A";
    }

    return "B";
}

/**
 * Obtener estadísticas de SDR
 * Para dashboard de métricas A/B
 */
async function getSDRStats() {
    try {
        // Contar establecimientos con tomador identificado
        const identified = await prisma.establishmentEnrichment.count({
            where: {
                decisionMakerName: { not: null },
            },
        });

        // Contar por nivel PROSPECT (tienen tomador + teléfono)
        const prospects = await prisma.establishmentEnrichment.count({
            where: {
                level: "PROSPECT",
            },
        });

        return {
            totalIdentified: identified,
            totalProspects: prospects,
            // TODO: Agregar métricas por estrategia cuando tengamos sdr_interactions
        };
    } catch (error) {
        logger.error("Error getting SDR stats:", error);
        throw error;
    }
}

module.exports = {
    saveCallResult,
    logSDRInteraction,
    getEstablishmentForCall,
    getRecommendedStrategy,
    getSDRStats,
};
