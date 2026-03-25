const couponWhatsappService = require("../services/couponWhatsappService");
const logger = require("../config/logger");

/**
 * Envía un cupón existente via WhatsApp
 */
const sendCoupon = async (req, res, next) => {
  try {
    const { couponId } = req.params;
    const { phone, from } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: "Phone number is required"
      });
    }

    const result = await couponWhatsappService.sendCouponViaWhatsapp({
      couponId,
      phone,
      from
    });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error
      });
    }

    res.json({
      success: true,
      data: {
        couponId,
        phone,
        messageId: result.messageId
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Envía múltiples cupones a un contacto de campaña
 */
const sendCouponsToCampaignContact = async (req, res, next) => {
  try {
    const { campaignContactId } = req.params;
    const { couponIds, from } = req.body;

    if (!Array.isArray(couponIds) || couponIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "couponIds must be a non-empty array"
      });
    }

    const result = await couponWhatsappService.sendCouponsToCampaignContact({
      campaignContactId,
      couponIds,
      from
    });

    res.json({
      success: result.success,
      data: {
        campaignContactId,
        sent: result.sent,
        failed: result.failed,
        results: result.results
      },
      error: result.error
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Genera y envía un cupón en una sola operación
 */
const generateAndSendCoupon = async (req, res, next) => {
  try {
    const {
      phone,
      prospectName,
      businessName,
      scenario,
      agentId,
      callId,
      campaignId,
      campaignContactId,
      couponType,
      from
    } = req.body;

    if (!phone || !prospectName || !businessName || !agentId || !callId) {
      return res.status(400).json({
        success: false,
        error: "phone, prospectName, businessName, agentId, and callId are required"
      });
    }

    const result = await couponWhatsappService.generateAndSendCoupon({
      phone,
      prospectName,
      businessName,
      scenario,
      agentId,
      callId,
      campaignId,
      campaignContactId,
      couponType,
      from
    });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error
      });
    }

    res.status(201).json({
      success: true,
      data: {
        coupon: result.coupon,
        messageId: result.messageId
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Reenvía un cupón existente
 */
const resendCoupon = async (req, res, next) => {
  try {
    const { couponId } = req.params;
    const { phone, from } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: "Phone number is required"
      });
    }

    const result = await couponWhatsappService.resendCoupon(couponId, phone, from);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error
      });
    }

    res.json({
      success: true,
      data: {
        couponId,
        phone,
        messageId: result.messageId
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  sendCoupon,
  sendCouponsToCampaignContact,
  generateAndSendCoupon,
  resendCoupon
};
