const prisma = require("../config/database");

// Dashboard global para admin
const getAdminDashboard = async () => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));

  const [
    totalPartners,
    activePartners,
    pendingPartners,
    partnersByType,
    partnersByTier,
    totalLeads,
    newLeadsThisWeek,
    newLeadsThisMonth,
    leadsByStatus,
    totalDeals,
    dealsThisMonth,
    revenueTotal,
    revenueThisMonth,
    commissionsTotal,
    commissionsPending,
  ] = await Promise.all([
    prisma.partner.count(),
    prisma.partner.count({ where: { status: "ACTIVE" } }),
    prisma.partner.count({ where: { status: "PENDING" } }),
    prisma.partner.groupBy({
      by: ["type"],
      _count: { type: true },
    }),
    prisma.partner.groupBy({
      by: ["tier"],
      _count: { tier: true },
    }),
    prisma.lead.count(),
    prisma.lead.count({
      where: { createdAt: { gte: startOfWeek } },
    }),
    prisma.lead.count({
      where: { createdAt: { gte: startOfMonth } },
    }),
    prisma.lead.groupBy({
      by: ["status"],
      _count: { status: true },
    }),
    prisma.deal.count(),
    prisma.deal.count({
      where: { closedAt: { gte: startOfMonth } },
    }),
    prisma.deal.aggregate({
      _sum: { totalValue: true },
    }),
    prisma.deal.aggregate({
      where: { closedAt: { gte: startOfMonth } },
      _sum: { totalValue: true },
    }),
    prisma.commission.aggregate({
      _sum: { amount: true },
    }),
    prisma.commission.aggregate({
      where: { status: "PENDING" },
      _sum: { amount: true },
    }),
  ]);

  // Transformar agrupaciones
  const typeMap = {};
  partnersByType.forEach((item) => {
    typeMap[item.type] = item._count.type;
  });

  const tierMap = {};
  partnersByTier.forEach((item) => {
    tierMap[item.tier] = item._count.tier;
  });

  const statusMap = {};
  leadsByStatus.forEach((item) => {
    statusMap[item.status] = item._count.status;
  });

  // Calcular tasas
  const conversionRate = totalLeads > 0 
    ? ((totalDeals / totalLeads) * 100).toFixed(1)
    : 0;

  const activationRate = totalPartners > 0
    ? ((activePartners / totalPartners) * 100).toFixed(1)
    : 0;

  return {
    totalPartners,
    activePartners,
    pendingPartners,
    partnersByType: typeMap,
    partnersByTier: tierMap,
    totalLeads,
    newLeadsThisWeek,
    newLeadsThisMonth,
    leadsByStatus: statusMap,
    totalDeals,
    dealsThisMonth,
    totalRevenue: parseFloat(revenueTotal._sum.totalValue || 0),
    revenueThisMonth: parseFloat(revenueThisMonth._sum.totalValue || 0),
    totalCommissions: parseFloat(commissionsTotal._sum.amount || 0),
    pendingCommissions: parseFloat(commissionsPending._sum.amount || 0),
    conversionRate: parseFloat(conversionRate),
    activationRate: parseFloat(activationRate),
  };
};

// Análisis por campañas UTM
const getCampaignAnalytics = async (filters = {}) => {
  const { dateFrom, dateTo } = filters;

  const where = {};
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) where.createdAt.lte = new Date(dateTo);
  }

  // Agrupar leads por campaña
  const leadsByCampaign = await prisma.lead.groupBy({
    by: ["utmCampaign", "utmSource", "utmMedium"],
    where: {
      ...where,
      utmCampaign: { not: null },
    },
    _count: { id: true },
  });

  // Para cada campaña, obtener conversiones
  const campaignStats = await Promise.all(
    leadsByCampaign.map(async (campaign) => {
      const deals = await prisma.deal.count({
        where: {
          lead: {
            utmCampaign: campaign.utmCampaign,
            utmSource: campaign.utmSource,
          },
        },
      });

      const revenue = await prisma.deal.aggregate({
        where: {
          lead: {
            utmCampaign: campaign.utmCampaign,
            utmSource: campaign.utmSource,
          },
        },
        _sum: { totalValue: true },
      });

      return {
        utmCampaign: campaign.utmCampaign,
        utmSource: campaign.utmSource,
        utmMedium: campaign.utmMedium,
        totalLeads: campaign._count.id,
        totalDeals: deals,
        totalRevenue: parseFloat(revenue._sum.totalValue || 0),
        conversionRate: campaign._count.id > 0 
          ? ((deals / campaign._count.id) * 100).toFixed(1)
          : 0,
      };
    })
  );

  return campaignStats.sort((a, b) => b.totalLeads - a.totalLeads);
};

// Top partners
const getTopPartners = async (limit = 10, metric = "revenue") => {
  const orderBy = metric === "revenue" 
    ? { totalRevenue: "desc" }
    : metric === "deals"
    ? { totalDeals: "desc" }
    : { totalLeads: "desc" };

  return prisma.partner.findMany({
    where: { status: "ACTIVE" },
    include: {
      user: {
        select: {
          name: true,
          email: true,
        },
      },
    },
    orderBy,
    take: limit,
  });
};

// Tendencias por período
const getTrends = async (period = "week", weeks = 12) => {
  const now = new Date();
  const trends = [];

  for (let i = weeks - 1; i >= 0; i--) {
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - (i * 7) - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const [leads, deals, revenue] = await Promise.all([
      prisma.lead.count({
        where: {
          createdAt: {
            gte: weekStart,
            lt: weekEnd,
          },
        },
      }),
      prisma.deal.count({
        where: {
          closedAt: {
            gte: weekStart,
            lt: weekEnd,
          },
        },
      }),
      prisma.deal.aggregate({
        where: {
          closedAt: {
            gte: weekStart,
            lt: weekEnd,
          },
        },
        _sum: { totalValue: true },
      }),
    ]);

    trends.push({
      period: weekStart.toISOString().split("T")[0],
      leads,
      deals,
      revenue: parseFloat(revenue._sum.totalValue || 0),
    });
  }

  return trends;
};

// Embudo de conversión
const getFunnel = async (filters = {}) => {
  const { partnerId, dateFrom, dateTo } = filters;

  const where = {};
  if (partnerId) where.partnerId = partnerId;
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) where.createdAt.lte = new Date(dateTo);
  }

  const [
    totalLeads,
    contacted,
    qualified,
    negotiation,
    won,
    lost,
  ] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.count({ where: { ...where, status: "CONTACTED" } }),
    prisma.lead.count({ where: { ...where, status: "QUALIFIED" } }),
    prisma.lead.count({ where: { ...where, status: "NEGOTIATION" } }),
    prisma.lead.count({ where: { ...where, status: "WON" } }),
    prisma.lead.count({ where: { ...where, status: "LOST" } }),
  ]);

  return {
    stages: [
      { name: "Nuevos", count: totalLeads, percentage: 100 },
      { 
        name: "Contactados", 
        count: contacted + qualified + negotiation + won, 
        percentage: totalLeads > 0 ? (((contacted + qualified + negotiation + won) / totalLeads) * 100).toFixed(1) : 0 
      },
      { 
        name: "Calificados", 
        count: qualified + negotiation + won, 
        percentage: totalLeads > 0 ? (((qualified + negotiation + won) / totalLeads) * 100).toFixed(1) : 0 
      },
      { 
        name: "Negociación", 
        count: negotiation + won, 
        percentage: totalLeads > 0 ? (((negotiation + won) / totalLeads) * 100).toFixed(1) : 0 
      },
      { 
        name: "Ganados", 
        count: won, 
        percentage: totalLeads > 0 ? ((won / totalLeads) * 100).toFixed(1) : 0 
      },
    ],
    lost,
    conversionRate: totalLeads > 0 ? ((won / totalLeads) * 100).toFixed(1) : 0,
  };
};

// KPIs del programa
const getProgramKPIs = async () => {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30));
  const ninetyDaysAgo = new Date(new Date().setDate(new Date().getDate() - 90));

  // Partners con al menos 1 venta en primeros 90 días
  const recentPartners = await prisma.partner.findMany({
    where: {
      createdAt: { gte: ninetyDaysAgo },
      status: "ACTIVE",
    },
    select: {
      id: true,
      createdAt: true,
      firstSaleAt: true,
    },
  });

  const activatedPartners = recentPartners.filter((p) => {
    if (!p.firstSaleAt) return false;
    const daysSinceCreation = Math.floor(
      (new Date(p.firstSaleAt).getTime() - new Date(p.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    );
    return daysSinceCreation <= 90;
  });

  const activationRate = recentPartners.length > 0
    ? ((activatedPartners.length / recentPartners.length) * 100).toFixed(1)
    : 0;

  // Tiempo medio a primera venta
  const partnersWithSales = await prisma.partner.findMany({
    where: {
      firstSaleAt: { not: null },
    },
    select: {
      createdAt: true,
      firstSaleAt: true,
    },
  });

  const avgTimeToFirstSale = partnersWithSales.length > 0
    ? partnersWithSales.reduce((sum, p) => {
        return sum + Math.floor(
          (new Date(p.firstSaleAt).getTime() - new Date(p.createdAt).getTime()) / (1000 * 60 * 60 * 24)
        );
      }, 0) / partnersWithSales.length
    : 0;

  // Revenue via partners vs total (asumiendo que todo viene de partners)
  const totalRevenue = await prisma.deal.aggregate({
    _sum: { totalValue: true },
  });

  return {
    activationRate: parseFloat(activationRate),
    avgTimeToFirstSale: Math.round(avgTimeToFirstSale),
    totalPartnersRecent: recentPartners.length,
    activatedPartnersRecent: activatedPartners.length,
    totalRevenue: parseFloat(totalRevenue._sum.totalValue || 0),
    partnerContribution: 100, // Asumiendo 100% por ahora
  };
};

module.exports = {
  getAdminDashboard,
  getCampaignAnalytics,
  getTopPartners,
  getTrends,
  getFunnel,
  getProgramKPIs,
};

