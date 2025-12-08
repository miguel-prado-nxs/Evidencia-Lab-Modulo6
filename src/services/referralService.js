const prisma = require("../config/database");

const BASE_URL = "https://easyorder.mx/";

/**
 * Generar el link completo con parámetros UTM
 */
const buildFullLink = (partnerCode, utmParams) => {
  const params = new URLSearchParams();
  params.set("ref", partnerCode);
  
  if (utmParams.utmSource) params.set("utm_source", utmParams.utmSource);
  if (utmParams.utmMedium) params.set("utm_medium", utmParams.utmMedium);
  if (utmParams.utmCampaign) params.set("utm_campaign", utmParams.utmCampaign);
  if (utmParams.utmTerm) params.set("utm_term", utmParams.utmTerm);
  if (utmParams.utmContent) params.set("utm_content", utmParams.utmContent);
  
  return `${BASE_URL}?${params.toString()}`;
};

/**
 * Crear una nueva campaña UTM
 */
const createCampaign = async (partnerId, data) => {
  const { name, utmSource, utmMedium, utmCampaign, utmTerm, utmContent } = data;

  // Obtener el código del partner
  const partner = await prisma.partner.findUnique({
    where: { id: partnerId },
    select: { code: true },
  });

  if (!partner) {
    throw new Error("Partner no encontrado");
  }

  // Generar el link completo
  const fullLink = buildFullLink(partner.code, {
    utmSource,
    utmMedium,
    utmCampaign,
    utmTerm,
    utmContent,
  });

  // Crear la campaña
  const campaign = await prisma.referralCampaign.create({
    data: {
      partnerId,
      name,
      utmSource,
      utmMedium,
      utmCampaign,
      utmTerm,
      utmContent,
      fullLink,
    },
  });

  return campaign;
};

/**
 * Listar campañas del partner con estadísticas calculadas
 */
const listCampaigns = async (partnerId) => {
  // Obtener todas las campañas del partner
  const campaigns = await prisma.referralCampaign.findMany({
    where: { partnerId },
    orderBy: { createdAt: "desc" },
  });

  // Para cada campaña, calcular estadísticas desde leads
  const campaignsWithStats = await Promise.all(
    campaigns.map(async (campaign) => {
      // Contar leads con este utm_campaign
      const leadsCount = await prisma.lead.count({
        where: {
          partnerId,
          utmCampaign: campaign.utmCampaign,
          utmSource: campaign.utmSource,
        },
      });

      // Contar conversiones (leads WON)
      const conversionsCount = await prisma.lead.count({
        where: {
          partnerId,
          utmCampaign: campaign.utmCampaign,
          utmSource: campaign.utmSource,
          status: "WON",
        },
      });

      // Calcular revenue de deals asociados
      const revenue = await prisma.deal.aggregate({
        where: {
          partnerId,
          lead: {
            utmCampaign: campaign.utmCampaign,
            utmSource: campaign.utmSource,
          },
        },
        _sum: { totalValue: true },
      });

      const conversionRate = leadsCount > 0
        ? ((conversionsCount / leadsCount) * 100).toFixed(1)
        : 0;

      return {
        ...campaign,
        leads: leadsCount,
        conversions: conversionsCount,
        conversionRate: parseFloat(conversionRate),
        revenue: parseFloat(revenue._sum.totalValue || 0),
      };
    })
  );

  return campaignsWithStats;
};

/**
 * Obtener una campaña por ID
 */
const getCampaignById = async (partnerId, campaignId) => {
  const campaign = await prisma.referralCampaign.findFirst({
    where: {
      id: campaignId,
      partnerId,
    },
  });

  if (!campaign) {
    return null;
  }

  // Agregar estadísticas
  const leadsCount = await prisma.lead.count({
    where: {
      partnerId,
      utmCampaign: campaign.utmCampaign,
      utmSource: campaign.utmSource,
    },
  });

  const conversionsCount = await prisma.lead.count({
    where: {
      partnerId,
      utmCampaign: campaign.utmCampaign,
      utmSource: campaign.utmSource,
      status: "WON",
    },
  });

  const revenue = await prisma.deal.aggregate({
    where: {
      partnerId,
      lead: {
        utmCampaign: campaign.utmCampaign,
        utmSource: campaign.utmSource,
      },
    },
    _sum: { totalValue: true },
  });

  return {
    ...campaign,
    leads: leadsCount,
    conversions: conversionsCount,
    conversionRate: leadsCount > 0 ? ((conversionsCount / leadsCount) * 100).toFixed(1) : 0,
    revenue: parseFloat(revenue._sum.totalValue || 0),
  };
};

/**
 * Eliminar una campaña
 */
const deleteCampaign = async (partnerId, campaignId) => {
  // Verificar que la campaña pertenece al partner
  const campaign = await prisma.referralCampaign.findFirst({
    where: {
      id: campaignId,
      partnerId,
    },
  });

  if (!campaign) {
    throw new Error("Campaña no encontrada");
  }

  await prisma.referralCampaign.delete({
    where: { id: campaignId },
  });

  return true;
};

/**
 * Obtener estadísticas del link principal de referido
 */
const getReferralStats = async (partnerId) => {
  // Total de leads del partner
  const totalLeads = await prisma.lead.count({
    where: { partnerId },
  });

  // Conversiones (leads WON)
  const conversions = await prisma.deal.count({
    where: { partnerId },
  });

  // Como no tenemos tracking de clics real, usamos leads como proxy
  // En una implementación completa, tendríamos un modelo ReferralClick
  const totalClicks = totalLeads * 3; // Estimación: 3 clics por lead
  const uniqueVisitors = Math.round(totalClicks * 0.7); // Estimación: 70% únicos

  const conversionRate = totalClicks > 0
    ? ((conversions / totalClicks) * 100).toFixed(1)
    : 0;

  return {
    totalClicks,
    uniqueVisitors,
    conversions,
    conversionRate: parseFloat(conversionRate),
    // Datos adicionales útiles
    totalLeads,
    leadsThisMonth: await prisma.lead.count({
      where: {
        partnerId,
        createdAt: {
          gte: new Date(new Date().setDate(1)), // Primer día del mes
        },
      },
    }),
  };
};

/**
 * Actualizar estadísticas de campaña (para uso futuro con tracking real)
 */
const updateCampaignStats = async (campaignId, clicks = 0, uniqueClicks = 0) => {
  return prisma.referralCampaign.update({
    where: { id: campaignId },
    data: {
      clicks: { increment: clicks },
      uniqueClicks: { increment: uniqueClicks },
    },
  });
};

/**
 * Obtener el código y link del partner
 */
const getPartnerReferralInfo = async (partnerId) => {
  const partner = await prisma.partner.findUnique({
    where: { id: partnerId },
    select: {
      code: true,
      referralLink: true,
    },
  });

  if (!partner) {
    throw new Error("Partner no encontrado");
  }

  return {
    code: partner.code,
    referralLink: partner.referralLink,
    baseUrl: BASE_URL,
  };
};

module.exports = {
  createCampaign,
  listCampaigns,
  getCampaignById,
  deleteCampaign,
  getReferralStats,
  updateCampaignStats,
  getPartnerReferralInfo,
  buildFullLink,
};

