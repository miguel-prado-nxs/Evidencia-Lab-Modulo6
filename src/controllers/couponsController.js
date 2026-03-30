const couponService = require("../services/couponService");
const couponGeneratorService = require("../services/couponGeneratorService");
const campaignsService = require("../services/campaignsService");
const { sendWhatsAppMessage } = require("../services/whatsappService");
const logger = require("../config/logger");

const create = async (req, res, next) => {
  try {
    const { campaignId, code, offer } = req.body;

    const campaign = await campaignsService.getCampaignById(campaignId);

    if (req.user?.role !== "ADMIN" && campaign.createdBy !== req.user?.id) {
      return res.status(403).json({
        success: false,
        error: "No tienes permisos para crear cupones en esta campaña",
      });
    }

    const coupon = await couponService.createCoupon({
      campaignId,
      code,
      offer,
    });

    res.status(201).json({
      success: true,
      data: coupon,
    });
  } catch (error) {
    next(error);
  }
};

const generateBulk = async (req, res, next) => {
  try {
    const { campaignId, count, offerTemplate } = req.body;

    const campaign = await campaignsService.getCampaignById(campaignId);

    if (req.user?.role !== "ADMIN" && campaign.createdBy !== req.user?.id) {
      return res.status(403).json({
        success: false,
        error: "No tienes permisos para generar cupones en esta campaña",
      });
    }

    const coupons = await couponService.generateBulkCoupons(campaignId, count, offerTemplate);

    res.status(201).json({
      success: true,
      data: coupons,
      message: `${coupons.length} cupones generados exitosamente`,
    });
  } catch (error) {
    next(error);
  }
};

const getByCode = async (req, res, next) => {
  try {
    const { code } = req.params;
    const coupon = await couponService.getCouponByCode(code);

    res.json({
      success: true,
      data: coupon,
    });
  } catch (error) {
    next(error);
  }
};

const getById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const coupon = await couponService.getCouponById(id);

    res.json({
      success: true,
      data: coupon,
    });
  } catch (error) {
    next(error);
  }
};

const list = async (req, res, next) => {
  try {
    const { campaignId, status, page, limit } = req.query;

    if (campaignId) {
      const campaign = await campaignsService.getCampaignById(campaignId);

      if (req.user?.role !== "ADMIN" && campaign.createdBy !== req.user?.id) {
        return res.status(403).json({
          success: false,
          error: "No tienes permisos para ver los cupones de esta campaña",
        });
      }
    }

    const result = await couponService.listCoupons({
      campaignId,
      status,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
    });

    res.json({
      success: true,
      data: result.coupons,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

const trackVisit = async (req, res, next) => {
  try {
    const { code } = req.params;
    const { metadata } = req.body;

    const coupon = await couponService.trackCouponVisit(code, metadata);

    res.json({
      success: true,
      data: coupon,
      message: "Visita registrada exitosamente",
    });
  } catch (error) {
    next(error);
  }
};

const markAsConverted = async (req, res, next) => {
  try {
    const { code } = req.params;
    const { conversionData } = req.body;

    const coupon = await couponService.markCouponAsConverted(code, conversionData);

    res.json({
      success: true,
      data: coupon,
      message: "Cupón marcado como convertido exitosamente",
    });
  } catch (error) {
    next(error);
  }
};

const assignToContact = async (req, res, next) => {
  try {
    const { couponId } = req.params;
    const { contactId } = req.body;

    const contact = await couponService.assignCouponToContact(couponId, contactId);

    res.json({
      success: true,
      data: contact,
      message: "Cupón asignado al contacto exitosamente",
    });
  } catch (error) {
    next(error);
  }
};

const getAvailable = async (req, res, next) => {
  try {
    const { campaignId } = req.query;

    if (!campaignId) {
      return res.status(400).json({
        success: false,
        error: "campaignId es requerido",
      });
    }

    const campaign = await campaignsService.getCampaignById(campaignId);

    if (req.user?.role !== "ADMIN" && campaign.createdBy !== req.user?.id) {
      return res.status(403).json({
        success: false,
        error: "No tienes permisos para ver los cupones disponibles de esta campaña",
      });
    }

    const coupons = await couponService.getAvailableCoupons(campaignId);

    res.json({
      success: true,
      data: coupons,
    });
  } catch (error) {
    next(error);
  }
};

const getStats = async (req, res, next) => {
  try {
    const { id } = req.params;

    const stats = await couponService.getCouponStats(id);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
};

const generateForCall = async (req, res, next) => {
  try {
    const {
      phone,
      prospectName,
      businessName,
      scenario,
      bantScores,
      agentId,
      callId,
      campaignId,
      campaignContext
    } = req.body;

    // Extraer valores de campaignContext si existe
    const effectiveCampaignId = campaignContext?.campaignId || campaignId;
    const campaignContactId = campaignContext?.campaignContactId || null;
    const couponType = campaignContext?.couponType || null;

    // Validar: debe venir scenario O couponType
    if (!phone || !prospectName || !businessName || !agentId || !callId) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: phone, prospectName, businessName, agentId, callId"
      });
    }

    if (!scenario && !couponType) {
      return res.status(400).json({
        success: false,
        error: "Either scenario or campaignContext.couponType is required"
      });
    }

    logger.info("Generating coupon for call", {
      phone,
      agentId,
      callId,
      campaignId: effectiveCampaignId,
      campaignContactId,
      couponType,
      scenario,
      hasCampaignContext: !!campaignContext
    });

    const result = await couponGeneratorService.generateCouponForCall({
      phone,
      prospectName,
      businessName,
      scenario,
      bantScores,
      agentId,
      callId,
      campaignId: effectiveCampaignId,
      campaignContactId,
      couponType
    });

    logger.info("Coupon generated successfully", {
      couponId: result.coupon.id,
      code: result.coupon.code,
      campaignContactId,
      callId
    });

    // ── Enviar cupón por WhatsApp vía Baileys ──
    let whatsappSent = false;
    try {
      const whatsappResult = await sendWhatsAppMessage({
        to: phone,
        message: result.message,
        mediaUrl: result.template.mediaUrl || null,
        mediaType: result.template.mediaUrl ? "image" : undefined,
      });
      whatsappSent = whatsappResult.success;

      if (whatsappSent) {
        logger.info("WhatsApp coupon message sent", {
          phone,
          couponCode: result.coupon.code,
          callId,
        });
      } else {
        logger.warn("WhatsApp coupon message failed (non-blocking)", {
          phone,
          error: whatsappResult.error,
          callId,
        });
      }
    } catch (waError) {
      logger.error("WhatsApp send threw exception (non-blocking)", {
        error: waError.message,
        phone,
        callId,
      });
    }

    res.status(201).json({
      success: true,
      data: {
        coupon: result.coupon,
        message: result.message,
        mediaUrl: result.template.mediaUrl,
        whatsappSent,
      }
    });
  } catch (error) {
    logger.error("Error generating coupon for call", {
      error: error.message,
      phone: req.body?.phone,
      callId: req.body?.callId,
      campaignContext: req.body?.campaignContext
    });
    next(error);
  }
};

const redeemCoupon = async (req, res, next) => {
  try {
    const { code } = req.params;
    const { userData } = req.body;

    const result = await couponGeneratorService.redeemCoupon(code, userData);

    res.json({
      success: true,
      data: {
        coupon: result.coupon,
        stripeConfig: result.stripeConfig
      },
      message: "Cupón redimido exitosamente"
    });
  } catch (error) {
    next(error);
  }
};

const checkEligibility = async (req, res, next) => {
  try {
    const { phone, couponType } = req.body;

    if (!phone || !couponType) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: phone, couponType"
      });
    }

    const result = await couponGeneratorService.checkEligibility(phone, couponType);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Obtiene cupones activos con tiempo restante en tiempo real
 */
const getActiveWithTimeRemaining = async (req, res, next) => {
  try {
    const { campaignId } = req.query;

    if (campaignId) {
      const campaign = await campaignsService.getCampaignById(campaignId);

      if (req.user?.role !== "ADMIN" && campaign.createdBy !== req.user?.id) {
        return res.status(403).json({
          success: false,
          error: "No tienes permisos para ver los cupones de esta campaña",
        });
      }
    }

    const coupons = await couponService.getActiveCouponsWithTimeRemaining({ campaignId });

    res.json({
      success: true,
      data: coupons,
      count: coupons.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Marca cupones expirados automáticamente
 */
const markExpired = async (req, res, next) => {
  try {
    const count = await couponService.markExpiredCoupons();

    res.json({
      success: true,
      data: {
        expiredCount: count
      },
      message: `${count} cupones marcados como expirados`
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Valida si un cupón puede ser usado en este momento
 */
const validateForUse = async (req, res, next) => {
  try {
    const { code } = req.params;

    const result = await couponService.validateCouponForUse(code);

    res.json({
      success: result.valid,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  create,
  generateBulk,
  getByCode,
  getById,
  list,
  trackVisit,
  markAsConverted,
  assignToContact,
  getAvailable,
  getStats,
  generateForCall,
  redeemCoupon,
  checkEligibility,
  getActiveWithTimeRemaining,
  markExpired,
  validateForUse
};
