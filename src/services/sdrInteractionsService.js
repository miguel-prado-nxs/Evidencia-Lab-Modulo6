/**
 * SDR Interactions Service
 * Servicios para registrar y consultar todas las interacciones del agente SDR
 * 
 * Esta tabla guarda TODAS las llamadas, exitosas o fallidas, para:
 * - Historial de intentos por establecimiento
 * - Métricas A/B por estrategia
 * - Análisis de efectividad del SDR
 */

const prisma = require("../config/database");
const logger = require("../config/logger");

/**
 * Crear un nuevo registro de interacción SDR
 * @param {Object} data - Datos de la interacción
 * @returns {Object} - Registro creado
 */
async function createInteraction(data) {
    try {
        const {
            establishmentId,
            callStatus,
            enrichmentStatus,
            decisionMakerFound = false,
            decisionMakerName,
            decisionMakerRole,
            callSummary,
            callDurationSeconds,
            attemptNumber = 1,
            strategy,
            gatekeeperInfo,
            twilioCallSid,
        } = data;

        const interaction = await prisma.sdrInteraction.create({
            data: {
                establishmentId,
                callStatus,
                enrichmentStatus,
                decisionMakerFound,
                decisionMakerName,
                decisionMakerRole,
                callSummary,
                callDurationSeconds,
                attemptNumber,
                strategy,
                gatekeeperInfo,
                twilioCallSid,
            },
        });

        logger.info(`SDR Interaction created for ${establishmentId}`, {
            id: interaction.id,
            callStatus,
            enrichmentStatus,
            decisionMakerFound,
            strategy,
        });

        return interaction;
    } catch (error) {
        logger.error("Error creating SDR interaction:", error);
        throw error;
    }
}

/**
 * Obtener historial de interacciones por establecimiento
 * @param {string} establishmentId - ID del establecimiento
 * @returns {Array} - Lista de interacciones
 */
async function getByEstablishment(establishmentId) {
    try {
        const interactions = await prisma.sdrInteraction.findMany({
            where: { establishmentId },
            orderBy: { createdAt: "desc" },
        });

        return interactions;
    } catch (error) {
        logger.error("Error getting SDR interactions:", error);
        throw error;
    }
}

/**
 * Contar intentos previos para un establecimiento
 * @param {string} establishmentId - ID del establecimiento
 * @returns {number} - Número de intentos
 */
async function countAttempts(establishmentId) {
    try {
        const count = await prisma.sdrInteraction.count({
            where: { establishmentId },
        });
        return count;
    } catch (error) {
        logger.error("Error counting SDR attempts:", error);
        return 0;
    }
}

/**
 * Obtener estadísticas generales del SDR
 * Para dashboard y métricas A/B
 */
async function getStats() {
    try {
        // Total de llamadas
        const totalCalls = await prisma.sdrInteraction.count();

        // Llamadas exitosas (tomador identificado)
        const successfulCalls = await prisma.sdrInteraction.count({
            where: { decisionMakerFound: true },
        });

        // Por estrategia
        const byStrategy = await prisma.sdrInteraction.groupBy({
            by: ["strategy"],
            _count: { id: true },
            where: { strategy: { not: null } },
        });

        // Por status de enriquecimiento
        const byEnrichmentStatus = await prisma.sdrInteraction.groupBy({
            by: ["enrichmentStatus"],
            _count: { id: true },
            where: { enrichmentStatus: { not: null } },
        });

        // Tasa de éxito por estrategia
        const strategyStats = {};
        for (const s of byStrategy) {
            if (s.strategy) {
                const successCount = await prisma.sdrInteraction.count({
                    where: {
                        strategy: s.strategy,
                        decisionMakerFound: true,
                    },
                });
                strategyStats[s.strategy] = {
                    total: s._count.id,
                    successful: successCount,
                    successRate: s._count.id > 0 ? (successCount / s._count.id * 100).toFixed(1) : 0,
                };
            }
        }

        return {
            totalCalls,
            successfulCalls,
            successRate: totalCalls > 0 ? (successfulCalls / totalCalls * 100).toFixed(1) : 0,
            byStrategy: strategyStats,
            byEnrichmentStatus: byEnrichmentStatus.map(s => ({
                status: s.enrichmentStatus,
                count: s._count.id,
            })),
        };
    } catch (error) {
        logger.error("Error getting SDR stats:", error);
        throw error;
    }
}

module.exports = {
    createInteraction,
    getByEstablishment,
    countAttempts,
    getStats,
};
