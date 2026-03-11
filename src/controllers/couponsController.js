const couponService = require("../services/couponService");
const campaignsService = require("../services/campaignsService");
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
};
