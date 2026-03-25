const campaignContextService = require("../services/campaignContextService");
const logger = require("../config/logger");

/**
 * Obtiene el contexto de campaña para ElevenLabs
 */
const getCampaignContext = async (req, res, next) => {
  try {
    const { campaignId, campaignContactId } = req.query;

    if (!campaignId) {
      return res.status(400).json({
        success: false,
        error: "campaignId is required"
      });
    }

    const result = await campaignContextService.getCampaignContextForAgent(
      campaignId,
      campaignContactId
    );

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.json({
      success: true,
      data: result.data
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Obtiene instrucciones de cupones para un agente
 */
const getCouponInstructions = async (req, res, next) => {
  try {
    const { campaignId } = req.query;

    if (!campaignId) {
      return res.status(400).json({
        success: false,
        error: "campaignId is required"
      });
    }

    const context = await campaignContextService.buildCampaignContext(campaignId, null);

    if (!context) {
      return res.status(404).json({
        success: false,
        error: "Campaign not found"
      });
    }

    res.json({
      success: true,
      data: {
        campaignId,
        coupons: context.coupons,
        instructions: context.agentInstructions
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Obtiene los templates de cupones disponibles para una campaña
 */
const getCouponTemplates = async (req, res, next) => {
  try {
    const { campaignId } = req.query;

    if (!campaignId) {
      return res.status(400).json({
        success: false,
        error: "campaignId is required"
      });
    }

    const context = await campaignContextService.buildCampaignContext(campaignId, null);

    if (!context) {
      return res.status(404).json({
        success: false,
        error: "Campaign not found"
      });
    }

    res.json({
      success: true,
      data: {
        campaignId,
        templates: context.coupons.templates,
        sendInstructions: context.coupons.sendInstructions
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getCampaignContext,
  getCouponInstructions,
  getCouponTemplates
};
