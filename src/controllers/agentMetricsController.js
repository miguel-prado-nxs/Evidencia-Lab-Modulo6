const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * GET /api/agent-metrics
 * Obtiene métricas agregadas por configuración de agente (SDR + Qualification)
 */
async function getAgentMetrics(req, res) {
  try {
    const { agentType, dateFrom, dateTo } = req.query;

    const dateFilter = {};
    if (dateFrom) dateFilter.gte = new Date(dateFrom);
    if (dateTo) dateFilter.lte = new Date(dateTo);

    const result = [];

    // SDR Interactions metrics
    if (!agentType || agentType === 'SDR') {
      const sdrMetrics = await prisma.sdrInteraction.groupBy({
        by: ['agentConfigId'],
        where: {
          agentConfigId: { not: null },
          ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
        },
        _count: { id: true },
        _avg: { callDurationSeconds: true },
      });

      // Calcular métricas derivadas
      for (const m of sdrMetrics) {
        if (!m.agentConfigId) continue;

        // Contar llamadas exitosas (completed)
        const successfulCalls = await prisma.sdrInteraction.count({
          where: {
            agentConfigId: m.agentConfigId,
            callStatus: 'completed',
            ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
          },
        });

        // Contar conversiones (decision maker found)
        const conversions = await prisma.sdrInteraction.count({
          where: {
            agentConfigId: m.agentConfigId,
            decisionMakerFound: true,
            ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
          },
        });

        const totalCalls = m._count.id;

        result.push({
          agent_config_id: m.agentConfigId,
          agent_type: 'SDR',
          total_calls: totalCalls,
          successful_calls: successfulCalls,
          conversions: conversions,
          success_rate: totalCalls > 0 ? ((successfulCalls / totalCalls) * 100).toFixed(1) : 0,
          conversion_rate: totalCalls > 0 ? ((conversions / totalCalls) * 100).toFixed(1) : 0,
          avg_duration_seconds: m._avg.callDurationSeconds?.toFixed(1) || 0,
        });
      }
    }

    // Qualification Call Leads metrics
    if (!agentType || agentType === 'QUALIFICATION') {
      const qualMetrics = await prisma.callLead.groupBy({
        by: ['agentConfigId'],
        where: {
          agentConfigId: { not: null },
          ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
        },
        _count: { id: true },
        _avg: { callDurationSeconds: true },
      });

      for (const m of qualMetrics) {
        if (!m.agentConfigId) continue;

        // Contar llamadas exitosas (completed)
        const successfulCalls = await prisma.callLead.count({
          where: {
            agentConfigId: m.agentConfigId,
            callStatus: 'completed',
            ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
          },
        });

        // Contar conversiones (A or B qualification score)
        const conversions = await prisma.callLead.count({
          where: {
            agentConfigId: m.agentConfigId,
            qualificationScore: { in: ['A', 'B'] },
            ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
          },
        });

        const totalCalls = m._count.id;

        result.push({
          agent_config_id: m.agentConfigId,
          agent_type: 'QUALIFICATION',
          total_calls: totalCalls,
          successful_calls: successfulCalls,
          conversions: conversions,
          success_rate: totalCalls > 0 ? ((successfulCalls / totalCalls) * 100).toFixed(1) : 0,
          conversion_rate: totalCalls > 0 ? ((conversions / totalCalls) * 100).toFixed(1) : 0,
          avg_duration_seconds: m._avg.callDurationSeconds?.toFixed(1) || 0,
        });
      }
    }

    // Ordenar por tasa de conversión
    result.sort((a, b) => parseFloat(b.conversion_rate) - parseFloat(a.conversion_rate));

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error getting agent metrics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * GET /api/agent-metrics/:configId
 * Obtiene métricas detalladas de una configuración específica
 */
async function getConfigMetrics(req, res) {
  try {
    const { configId } = req.params;
    const { groupBy = 'day' } = req.query;

    // SDR Interactions
    const sdrTotal = await prisma.sdrInteraction.count({
      where: { agentConfigId: configId },
    });

    const sdrSuccessful = await prisma.sdrInteraction.count({
      where: { agentConfigId: configId, callStatus: 'completed' },
    });

    const sdrConversions = await prisma.sdrInteraction.count({
      where: { agentConfigId: configId, decisionMakerFound: true },
    });

    const sdrAvgDuration = await prisma.sdrInteraction.aggregate({
      where: { agentConfigId: configId },
      _avg: { callDurationSeconds: true },
    });

    // Qualification Calls
    const qualTotal = await prisma.callLead.count({
      where: { agentConfigId: configId },
    });

    const qualSuccessful = await prisma.callLead.count({
      where: { agentConfigId: configId, callStatus: 'completed' },
    });

    const qualConversions = await prisma.callLead.count({
      where: { agentConfigId: configId, qualificationScore: { in: ['A', 'B'] } },
    });

    const qualAvgDuration = await prisma.callLead.aggregate({
      where: { agentConfigId: configId },
      _avg: { callDurationSeconds: true },
    });

    const totalCalls = sdrTotal + qualTotal;
    const successfulCalls = sdrSuccessful + qualSuccessful;
    const conversions = sdrConversions + qualConversions;
    const avgDuration =
      ((sdrAvgDuration._avg.callDurationSeconds || 0) * sdrTotal +
        (qualAvgDuration._avg.callDurationSeconds || 0) * qualTotal) /
      (totalCalls || 1);

    res.json({
      success: true,
      data: {
        config_id: configId,
        general: {
          total_calls: totalCalls,
          successful_calls: successfulCalls,
          conversions: conversions,
          success_rate: totalCalls > 0 ? ((successfulCalls / totalCalls) * 100).toFixed(1) : 0,
          conversion_rate: totalCalls > 0 ? ((conversions / totalCalls) * 100).toFixed(1) : 0,
          avg_duration_seconds: avgDuration.toFixed(1),
        },
        by_type: {
          sdr: {
            total_calls: sdrTotal,
            successful_calls: sdrSuccessful,
            conversions: sdrConversions,
            avg_duration: sdrAvgDuration._avg.callDurationSeconds?.toFixed(1) || 0,
          },
          qualification: {
            total_calls: qualTotal,
            successful_calls: qualSuccessful,
            conversions: qualConversions,
            avg_duration: qualAvgDuration._avg.callDurationSeconds?.toFixed(1) || 0,
          },
        },
      },
    });
  } catch (error) {
    console.error('Error getting config metrics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

module.exports = {
  getAgentMetrics,
  getConfigMetrics,
};
