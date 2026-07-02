const referralService = require('../services/referralService');
const logger = require('../config/logger');

/**
 * Obtener información de referido del partner (código y link base)
 * GET /api/v1/referrals/info
 */
const getInfo = async (req, res, next) => {
  try {
    const partnerId = req.user.partner?.id;

    if (!partnerId) {
      return res.status(403).json({
        success: false,
        error: 'No tienes acceso a esta funcionalidad',
      });
    }

    const info = await referralService.getPartnerReferralInfo(partnerId);

    res.json({
      success: true,
      data: info,
    });
  } catch (error) {
    logger.error('Error getting referral info:', error);
    next(error);
  }
};

/**
 * Obtener estadísticas generales del link de referido
 * GET /api/v1/referrals/stats
 */
const getStats = async (req, res, next) => {
  try {
    const partnerId = req.user.partner?.id;

    if (!partnerId) {
      return res.status(403).json({
        success: false,
        error: 'No tienes acceso a esta funcionalidad',
      });
    }

    const stats = await referralService.getReferralStats(partnerId);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error('Error getting referral stats:', error);
    next(error);
  }
};

/**
 * Listar campañas UTM del partner
 * GET /api/v1/referrals/campaigns
 */
const listCampaigns = async (req, res, next) => {
  try {
    const partnerId = req.user.partner?.id;

    if (!partnerId) {
      return res.status(403).json({
        success: false,
        error: 'No tienes acceso a esta funcionalidad',
      });
    }

    const campaigns = await referralService.listCampaigns(partnerId);

    res.json({
      success: true,
      data: campaigns,
    });
  } catch (error) {
    logger.error('Error listing campaigns:', error);
    next(error);
  }
};

/**
 * Crear nueva campaña UTM
 * POST /api/v1/referrals/campaigns
 */
const createCampaign = async (req, res, next) => {
  try {
    const partnerId = req.user.partner?.id;

    if (!partnerId) {
      return res.status(403).json({
        success: false,
        error: 'No tienes acceso a esta funcionalidad',
      });
    }

    const { name, utmSource, utmMedium, utmCampaign, utmTerm, utmContent } = req.body;

    // Validaciones básicas
    if (!name || !utmSource || !utmMedium || !utmCampaign) {
      return res.status(400).json({
        success: false,
        error: 'Nombre, utm_source, utm_medium y utm_campaign son requeridos',
      });
    }

    const campaign = await referralService.createCampaign(partnerId, {
      name,
      utmSource,
      utmMedium,
      utmCampaign,
      utmTerm,
      utmContent,
    });

    res.status(201).json({
      success: true,
      data: campaign,
    });
  } catch (error) {
    logger.error('Error creating campaign:', error);

    // Error de constraint único (campaña duplicada)
    if (error.code === 'P2002') {
      return res.status(400).json({
        success: false,
        error: 'Ya existe una campaña con ese nombre de campaña (utm_campaign)',
      });
    }

    next(error);
  }
};

/**
 * Obtener una campaña específica
 * GET /api/v1/referrals/campaigns/:id
 */
const getCampaign = async (req, res, next) => {
  try {
    const partnerId = req.user.partner?.id;
    const { id } = req.params;

    if (!partnerId) {
      return res.status(403).json({
        success: false,
        error: 'No tienes acceso a esta funcionalidad',
      });
    }

    const campaign = await referralService.getCampaignById(partnerId, id);

    if (!campaign) {
      return res.status(404).json({
        success: false,
        error: 'Campaña no encontrada',
      });
    }

    res.json({
      success: true,
      data: campaign,
    });
  } catch (error) {
    logger.error('Error getting campaign:', error);
    next(error);
  }
};

/**
 * Eliminar una campaña
 * DELETE /api/v1/referrals/campaigns/:id
 */
const deleteCampaign = async (req, res, next) => {
  try {
    const partnerId = req.user.partner?.id;
    const { id } = req.params;

    if (!partnerId) {
      return res.status(403).json({
        success: false,
        error: 'No tienes acceso a esta funcionalidad',
      });
    }

    await referralService.deleteCampaign(partnerId, id);

    res.json({
      success: true,
      message: 'Campaña eliminada correctamente',
    });
  } catch (error) {
    logger.error('Error deleting campaign:', error);

    if (error.message === 'Campaña no encontrada') {
      return res.status(404).json({
        success: false,
        error: error.message,
      });
    }

    next(error);
  }
};

module.exports = {
  getInfo,
  getStats,
  listCampaigns,
  createCampaign,
  getCampaign,
  deleteCampaign,
};
