/**
 * Admin Sales Service
 * Servicios para que administradores de ventas vean datos de todos los agentes
 *
 * Identifica partners de ventas por su código: VENTAS-{userId}
 */

const prisma = require('../config/database');
const prismaGeo = require('../config/database-geo');
const logger = require('../config/logger');

/**
 * Obtener todos los partners de ventas (código empieza con VENTAS-)
 */
async function getSalesPartners() {
  try {
    const partners = await prisma.partner.findMany({
      where: {
        code: { startsWith: 'VENTAS-' },
        type: 'TECHNOLOGY',
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        _count: {
          select: {
            prospects: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Obtener estadísticas adicionales para cada partner
    const partnersWithStats = await Promise.all(
      partners.map(async (partner) => {
        // Contar enrichments por nivel
        const enrichmentStats = await prisma.establishmentEnrichment.groupBy({
          by: ['level'],
          where: { enrichedBy: partner.id },
          _count: { id: true },
        });

        const stats = enrichmentStats.reduce(
          (acc, stat) => {
            acc[stat.level.toLowerCase()] = stat._count.id;
            return acc;
          },
          { prospect: 0, lead: 0, client: 0 }
        );

        return {
          id: partner.id,
          code: partner.code,
          companyName: partner.companyName,
          user: partner.user,
          totalProspects: partner._count.prospects + (stats.prospect || 0),
          totalLeads: stats.lead || 0,
          totalClients: stats.client || 0,
          createdAt: partner.createdAt,
          lastActivityAt: partner.lastActivityAt,
        };
      })
    );

    return partnersWithStats;
  } catch (error) {
    logger.error('Error obteniendo partners de ventas:', error);
    throw error;
  }
}

/**
 * Obtener todos los prospectos de todos los usuarios de ventas
 * @param {Object} filters - Filtros opcionales { salesPartnerId, status, level }
 */
async function getAllSalesProspects(filters = {}) {
  try {
    // 1. Obtener todos los partners de ventas
    const salesPartners = await prisma.partner.findMany({
      where: {
        code: { startsWith: 'VENTAS-' },
        type: 'TECHNOLOGY',
      },
      select: { id: true, code: true, companyName: true, user: { select: { name: true } } },
    });

    const salesPartnerIds = salesPartners.map((p) => p.id);
    const partnerMap = salesPartners.reduce((acc, p) => {
      acc[p.id] = { code: p.code, companyName: p.companyName, userName: p.user?.name };
      return acc;
    }, {});

    if (salesPartnerIds.length === 0) {
      return [];
    }

    // 2. Construir filtro de partner
    let partnerFilter;
    if (filters.salesPartnerId) {
      // Verificar que sea un partner de ventas válido
      if (!salesPartnerIds.includes(filters.salesPartnerId)) {
        return [];
      }
      partnerFilter = filters.salesPartnerId;
    } else {
      partnerFilter = { in: salesPartnerIds };
    }

    // 3. Obtener prospectos asignados
    const prospects = await prisma.leadProspect.findMany({
      where: {
        partnerId: partnerFilter,
        status: filters.status || 'ASSIGNED',
      },
      orderBy: { createdAt: 'desc' },
    });

    if (prospects.length === 0) {
      return [];
    }

    // 4. Obtener IDs de establecimientos
    const establishmentIds = [...new Set(prospects.map((p) => p.establishmentId))];

    // 5. Obtener datos de establecimientos de Mapa DB
    const establishments = await prismaGeo.establishment.findMany({
      where: { id: { in: establishmentIds } },
      select: {
        id: true,
        name: true,
        activityName: true,
        phone: true,
        email: true,
        website: true,
        latitude: true,
        longitude: true,
        municipalityName: true,
        stateName: true,
      },
    });

    // 6. Obtener enriquecimientos existentes
    const enrichments = await prisma.establishmentEnrichment.findMany({
      where: { establishmentId: { in: establishmentIds } },
    });

    // Crear mapas para lookup rápido
    const establishmentMap = establishments.reduce((acc, e) => {
      acc[e.id] = e;
      return acc;
    }, {});

    const enrichmentMap = enrichments.reduce((acc, e) => {
      acc[e.establishmentId] = e;
      return acc;
    }, {});

    // 7. Combinar datos con información del agente
    return prospects.map((p) => {
      const establishment = establishmentMap[p.establishmentId] || null;
      const enrichment = enrichmentMap[p.establishmentId] || null;
      const agent = partnerMap[p.partnerId] || null;

      return {
        id: enrichment?.id || p.id,
        establishmentId: p.establishmentId,
        level: enrichment?.level || 'PROSPECT',
        // Datos del agente de ventas
        agent: agent
          ? {
              partnerId: p.partnerId,
              code: agent.code,
              name: agent.userName || agent.companyName,
            }
          : null,
        // Datos de enriquecimiento
        decisionMakerName: enrichment?.decisionMakerName || null,
        decisionMakerPhone: enrichment?.decisionMakerPhone || null,
        decisionMakerWhatsApp: enrichment?.decisionMakerWhatsApp || null,
        decisionMakerEmail: enrichment?.decisionMakerEmail || null,
        intent: enrichment?.intent || null,
        fear: enrichment?.fear || null,
        pain: enrichment?.pain || null,
        desire: enrichment?.desire || null,
        // Metadatos
        enrichedBy: enrichment?.enrichedBy || p.partnerId,
        enrichedAt: enrichment?.enrichedAt || p.assignedAt,
        notes: p.notes,
        status: p.status,
        createdAt: p.createdAt,
        updatedAt: enrichment?.updatedAt || p.updatedAt,
        // Establecimiento
        establishment,
      };
    });
  } catch (error) {
    logger.error('Error obteniendo prospectos de ventas:', error);
    throw error;
  }
}

/**
 * Obtener todos los leads de todos los usuarios de ventas
 */
async function getAllSalesLeads(filters = {}) {
  try {
    // 1. Obtener todos los partners de ventas
    const salesPartners = await prisma.partner.findMany({
      where: {
        code: { startsWith: 'VENTAS-' },
        type: 'TECHNOLOGY',
      },
      select: { id: true, code: true, companyName: true, user: { select: { name: true } } },
    });

    const salesPartnerIds = salesPartners.map((p) => p.id);
    const partnerMap = salesPartners.reduce((acc, p) => {
      acc[p.id] = { code: p.code, companyName: p.companyName, userName: p.user?.name };
      return acc;
    }, {});

    if (salesPartnerIds.length === 0) {
      return [];
    }

    // 2. Construir filtro de partner
    let partnerFilter;
    if (filters.salesPartnerId) {
      if (!salesPartnerIds.includes(filters.salesPartnerId)) {
        return [];
      }
      partnerFilter = filters.salesPartnerId;
    } else {
      partnerFilter = { in: salesPartnerIds };
    }

    // 3. Obtener enrichments con nivel LEAD
    const enrichments = await prisma.establishmentEnrichment.findMany({
      where: {
        enrichedBy: partnerFilter,
        level: 'LEAD',
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (enrichments.length === 0) {
      return [];
    }

    // 4. Obtener datos de establecimientos
    const establishmentIds = enrichments.map((e) => e.establishmentId);
    const establishments = await prismaGeo.establishment.findMany({
      where: { id: { in: establishmentIds } },
      select: {
        id: true,
        name: true,
        activityName: true,
        phone: true,
        email: true,
        website: true,
        latitude: true,
        longitude: true,
        municipalityName: true,
        stateName: true,
      },
    });

    // 5. Obtener meetings
    const meetings = await prisma.establishmentMeeting.findMany({
      where: {
        partnerId: partnerFilter,
        establishmentId: { in: establishmentIds },
      },
    });

    const establishmentMap = establishments.reduce((acc, e) => {
      acc[e.id] = e;
      return acc;
    }, {});

    const meetingMap = meetings.reduce((acc, m) => {
      acc[m.establishmentId] = {
        meetingScheduled: m.meetingScheduled,
        meetingDate: m.meetingDate,
        meetingLink: m.meetingLink,
      };
      return acc;
    }, {});

    // 6. Combinar datos
    return enrichments.map((e) => {
      const establishment = establishmentMap[e.establishmentId] || null;
      const meeting = meetingMap[e.establishmentId] || null;
      const agent = partnerMap[e.enrichedBy] || null;

      return {
        ...e,
        agent: agent
          ? {
              partnerId: e.enrichedBy,
              code: agent.code,
              name: agent.userName || agent.companyName,
            }
          : null,
        establishment,
        meeting,
      };
    });
  } catch (error) {
    logger.error('Error obteniendo leads de ventas:', error);
    throw error;
  }
}

/**
 * Obtener todos los clientes de todos los usuarios de ventas
 */
async function getAllSalesClients(filters = {}) {
  try {
    // 1. Obtener todos los partners de ventas
    const salesPartners = await prisma.partner.findMany({
      where: {
        code: { startsWith: 'VENTAS-' },
        type: 'TECHNOLOGY',
      },
      select: { id: true, code: true, companyName: true, user: { select: { name: true } } },
    });

    const salesPartnerIds = salesPartners.map((p) => p.id);
    const partnerMap = salesPartners.reduce((acc, p) => {
      acc[p.id] = { code: p.code, companyName: p.companyName, userName: p.user?.name };
      return acc;
    }, {});

    if (salesPartnerIds.length === 0) {
      return [];
    }

    // 2. Construir filtro
    let partnerFilter;
    if (filters.salesPartnerId) {
      if (!salesPartnerIds.includes(filters.salesPartnerId)) {
        return [];
      }
      partnerFilter = filters.salesPartnerId;
    } else {
      partnerFilter = { in: salesPartnerIds };
    }

    // 3. Obtener enrichments con nivel CLIENT
    const enrichments = await prisma.establishmentEnrichment.findMany({
      where: {
        enrichedBy: partnerFilter,
        level: 'CLIENT',
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (enrichments.length === 0) {
      return [];
    }

    // 4. Obtener datos de establecimientos
    const establishmentIds = enrichments.map((e) => e.establishmentId);
    const establishments = await prismaGeo.establishment.findMany({
      where: { id: { in: establishmentIds } },
      select: {
        id: true,
        name: true,
        activityName: true,
        phone: true,
        email: true,
        website: true,
        latitude: true,
        longitude: true,
        municipalityName: true,
        stateName: true,
      },
    });

    const establishmentMap = establishments.reduce((acc, e) => {
      acc[e.id] = e;
      return acc;
    }, {});

    // 5. Combinar datos
    return enrichments.map((e) => {
      const establishment = establishmentMap[e.establishmentId] || null;
      const agent = partnerMap[e.enrichedBy] || null;

      return {
        ...e,
        agent: agent
          ? {
              partnerId: e.enrichedBy,
              code: agent.code,
              name: agent.userName || agent.companyName,
            }
          : null,
        establishment,
      };
    });
  } catch (error) {
    logger.error('Error obteniendo clientes de ventas:', error);
    throw error;
  }
}

/**
 * Obtener estadísticas agregadas de todos los usuarios de ventas
 */
async function getSalesStats() {
  try {
    // 1. Obtener partners de ventas
    const salesPartners = await prisma.partner.findMany({
      where: {
        code: { startsWith: 'VENTAS-' },
        type: 'TECHNOLOGY',
      },
      select: { id: true, code: true, companyName: true, user: { select: { name: true } } },
    });

    const salesPartnerIds = salesPartners.map((p) => p.id);

    if (salesPartnerIds.length === 0) {
      return {
        totalAgents: 0,
        totalProspects: 0,
        totalLeads: 0,
        totalClients: 0,
        byAgent: [],
      };
    }

    // 2. Estadísticas globales de enrichments
    const enrichmentStats = await prisma.establishmentEnrichment.groupBy({
      by: ['level'],
      where: { enrichedBy: { in: salesPartnerIds } },
      _count: { id: true },
    });

    // 3. Total de prospectos asignados
    const prospectCount = await prisma.leadProspect.count({
      where: {
        partnerId: { in: salesPartnerIds },
        status: 'ASSIGNED',
      },
    });

    // 4. Estadísticas por agente
    const byAgent = await Promise.all(
      salesPartners.map(async (partner) => {
        const [prospects, enrichments] = await Promise.all([
          prisma.leadProspect.count({
            where: { partnerId: partner.id, status: 'ASSIGNED' },
          }),
          prisma.establishmentEnrichment.groupBy({
            by: ['level'],
            where: { enrichedBy: partner.id },
            _count: { id: true },
          }),
        ]);

        const stats = enrichments.reduce(
          (acc, stat) => {
            acc[stat.level.toLowerCase()] = stat._count.id;
            return acc;
          },
          { prospect: 0, lead: 0, client: 0 }
        );

        return {
          partnerId: partner.id,
          code: partner.code,
          name: partner.user?.name || partner.companyName,
          prospects: prospects + (stats.prospect || 0),
          leads: stats.lead || 0,
          clients: stats.client || 0,
        };
      })
    );

    // Calcular totales
    const globalStats = enrichmentStats.reduce(
      (acc, stat) => {
        acc[stat.level.toLowerCase()] = stat._count.id;
        return acc;
      },
      { prospect: 0, lead: 0, client: 0 }
    );

    return {
      totalAgents: salesPartners.length,
      totalProspects: prospectCount + (globalStats.prospect || 0),
      totalLeads: globalStats.lead || 0,
      totalClients: globalStats.client || 0,
      byAgent,
    };
  } catch (error) {
    logger.error('Error obteniendo estadísticas de ventas:', error);
    throw error;
  }
}

module.exports = {
  getSalesPartners,
  getAllSalesProspects,
  getAllSalesLeads,
  getAllSalesClients,
  getSalesStats,
};
