const couponWhatsappService = require('../services/couponWhatsappService');
const logger = require('../config/logger');

/**
 * Endpoint para que ElevenLabs genere y envíe un cupón durante una llamada
 * Este es el endpoint que ElevenLabs llamará como webhook
 */
const generateForCall = async (req, res, next) => {
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
      from,
    } = req.body;

    // Validar parámetros requeridos
    if (!phone) {
      return res.status(400).json({
        success: false,
        error: 'phone is required',
      });
    }

    if (!prospectName) {
      return res.status(400).json({
        success: false,
        error: 'prospectName is required',
      });
    }

    if (!businessName) {
      return res.status(400).json({
        success: false,
        error: 'businessName is required',
      });
    }

    if (!scenario) {
      return res.status(400).json({
        success: false,
        error: 'scenario is required',
      });
    }

    if (!agentId) {
      return res.status(400).json({
        success: false,
        error: 'agentId is required',
      });
    }

    if (!callId) {
      return res.status(400).json({
        success: false,
        error: 'callId is required',
      });
    }

    logger.info('Generating coupon for call', {
      phone,
      prospectName,
      businessName,
      scenario,
      agentId,
      callId,
      campaignId,
      campaignContactId,
      couponType,
    });

    // Helper para ignorar variables no resueltas de Postman ("{{variable}}") o strings vacíos
    const parseOptionalId = (id) => (!id || id.startsWith('{{') ? null : id);

    // Generar y enviar el cupón
    const result = await couponWhatsappService.generateAndSendCoupon({
      phone,
      prospectName,
      businessName,
      scenario,
      agentId,
      callId,
      campaignId: parseOptionalId(campaignId),
      campaignContactId: parseOptionalId(campaignContactId),
      couponType: couponType || null,
      from: from || null,
    });

    if (!result.success) {
      logger.error('Failed to generate coupon for call', {
        phone,
        error: result.error,
      });

      return res.status(400).json({
        success: false,
        error: result.error,
      });
    }

    logger.info('Coupon generated and sent successfully', {
      couponId: result.coupon.id,
      couponCode: result.coupon.code,
      phone,
      messageId: result.messageId,
    });

    res.status(201).json({
      success: true,
      data: {
        coupon: {
          id: result.coupon.id,
          code: result.coupon.code,
          offer: result.coupon.offer,
          couponType: result.coupon.couponType,
          status: result.coupon.status,
          expiresAt: result.coupon.expiresAt,
          sentAt: result.coupon.sentAt,
        },
        messageId: result.messageId,
        phone: phone,
        message: 'Cupón generado y enviado exitosamente por WhatsApp',
      },
    });
  } catch (error) {
    logger.error('Error in generateForCall', {
      error: error.message,
      stack: error.stack,
    });

    next(error);
  }
};

module.exports = {
  generateForCall,
};
