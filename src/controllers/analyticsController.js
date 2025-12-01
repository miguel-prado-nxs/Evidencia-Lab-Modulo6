const analyticsService = require("../services/analyticsService");

// Dashboard global (admin)
const getDashboard = async (req, res, next) => {
  try {
    const dashboard = await analyticsService.getAdminDashboard();

    res.json({
      success: true,
      data: dashboard,
    });
  } catch (error) {
    next(error);
  }
};

// Análisis por campañas
const getCampaigns = async (req, res, next) => {
  try {
    const { dateFrom, dateTo } = req.query;

    const campaigns = await analyticsService.getCampaignAnalytics({
      dateFrom,
      dateTo,
    });

    res.json({
      success: true,
      data: campaigns,
    });
  } catch (error) {
    next(error);
  }
};

// Top partners
const getTopPartners = async (req, res, next) => {
  try {
    const { limit, metric } = req.query;

    const topPartners = await analyticsService.getTopPartners(
      parseInt(limit) || 10,
      metric || "revenue"
    );

    res.json({
      success: true,
      data: topPartners,
    });
  } catch (error) {
    next(error);
  }
};

// Tendencias
const getTrends = async (req, res, next) => {
  try {
    const { period, weeks } = req.query;

    const trends = await analyticsService.getTrends(
      period || "week",
      parseInt(weeks) || 12
    );

    res.json({
      success: true,
      data: trends,
    });
  } catch (error) {
    next(error);
  }
};

// Embudo de conversión
const getFunnel = async (req, res, next) => {
  try {
    const { partnerId, dateFrom, dateTo } = req.query;

    // Si no es admin, usar su partnerId
    const filterPartnerId = req.user.role === "ADMIN" 
      ? partnerId 
      : req.user.partner?.id;

    const funnel = await analyticsService.getFunnel({
      partnerId: filterPartnerId,
      dateFrom,
      dateTo,
    });

    res.json({
      success: true,
      data: funnel,
    });
  } catch (error) {
    next(error);
  }
};

// KPIs del programa (admin)
const getKPIs = async (req, res, next) => {
  try {
    const kpis = await analyticsService.getProgramKPIs();

    res.json({
      success: true,
      data: kpis,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDashboard,
  getCampaigns,
  getTopPartners,
  getTrends,
  getFunnel,
  getKPIs,
};

