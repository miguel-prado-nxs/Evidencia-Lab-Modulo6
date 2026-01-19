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
            agentConfigId,  // ID de la configuración del agente usada
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
                agentConfigId,  // Guardar referencia a la config usada
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
    getAgentConfigStats,
};

/**
 * Obtener estadísticas filtradas por agentConfigId
 * (Reemplaza la lógica anterior en demo-form-service usando call_leads)
 */
async function getAgentConfigStats(agentConfigId) {
    try {
        // Métricas generales
        const totalCalls = await prisma.sdrInteraction.count({
            where: { agentConfigId },
        });

        const successfulCalls = await prisma.sdrInteraction.count({
            where: {
                agentConfigId,
                callStatus: 'completed'
            },
        });

        const conversions = await prisma.sdrInteraction.count({
            where: {
                agentConfigId,
                decisionMakerFound: true
            },
        });

        const durationAgg = await prisma.sdrInteraction.aggregate({
            where: { agentConfigId },
            _avg: { callDurationSeconds: true },
        });

        // Timeline (Agrupado por día por defecto)
        // Prisma no soporta groupBy por fecha formateada directamente en todos los providers, 
        // pero podemos obtener los datos y agrupar en código o usar raw query si es PostgreSQL.
        // Asumiendo PostgreSQL por el código anterior (to_char).

        const timeline = await prisma.$queryRaw`
            SELECT 
                to_char("created_at", 'YYYY-MM-DD') as period,
                COUNT(*)::int as calls,
                SUM(CASE WHEN "decision_maker_found" = true THEN 1 ELSE 0 END)::int as conversions
            FROM "sdr_interactions"
            WHERE "agent_config_id"::text = ${agentConfigId}
            GROUP BY to_char("created_at", 'YYYY-MM-DD')
            ORDER BY period ASC
        `;

        return {
            general: {
                total_calls: totalCalls,
                successful_calls: successfulCalls,
                conversions: conversions,
                success_rate: totalCalls > 0 ? ((successfulCalls / totalCalls) * 100).toFixed(1) : 0,
                conversion_rate: totalCalls > 0 ? ((conversions / totalCalls) * 100).toFixed(1) : 0,
                avg_duration_seconds: durationAgg._avg.callDurationSeconds ? durationAgg._avg.callDurationSeconds.toFixed(1) : 0,
            },
            timeline,
        };
    } catch (error) {
        logger.error("Error getting SDR agent config stats:", error);
        throw error;
    }
}

/**
 * Obtener estadísticas de TODAS las configuraciones agrupadas
 */
async function getAllAgentConfigStats(params = {}) {
    try {
        const { dateFrom, dateTo } = params;

        // Construir cláusula WHERE dinámica
        let whereClause = `WHERE "agent_config_id" IS NOT NULL`;
        const queryParams = [];

        if (dateFrom) {
            whereClause += ` AND "created_at" >= $${queryParams.length + 1}::timestamp`;
            queryParams.push(`${dateFrom} 00:00:00`);
        }

        if (dateTo) {
            whereClause += ` AND "created_at" <= $${queryParams.length + 1}::timestamp`;
            queryParams.push(`${dateTo} 23:59:59`);
        }

        const query = `
            SELECT 
                "agent_config_id" as "agentConfigId",
                COUNT(*)::int as total_calls,
                SUM(CASE WHEN "call_status" = 'completed' THEN 1 ELSE 0 END)::int as successful_calls,
                SUM(CASE WHEN "decision_maker_found" = true THEN 1 ELSE 0 END)::int as conversions,
                AVG("call_duration_seconds") as avg_duration
            FROM "sdr_interactions"
            ${whereClause}
            GROUP BY "agent_config_id"
        `;

        const stats = await prisma.$queryRawUnsafe(query, ...queryParams);
        return stats;
    } catch (error) {
        logger.error("Error getting all agent config stats:", error);
        throw error;
    }
}

module.exports = {
    createInteraction,
    getByEstablishment,
    countAttempts,
    getStats,
    getAgentConfigStats,
    getAllAgentConfigStats,
};
