const prisma = require("../config/database");
const logger = require("../config/logger");
const whatsappService = require("./whatsappService");
const couponGeneratorService = require("./couponGeneratorService");
const axios = require("axios");

const BAILEYS_URL = process.env.BAILEYS_URL;
const BAILEYS_API_KEY = process.env.BAILEYS_API_KEY;



/**
 * Envía un cupón generado mediante WhatsApp usando Baileys
 * @param {object} params - Parámetros del envío
 * @param {string} params.couponId - ID del cupón a enviar
 * @param {string} params.phone - Número de teléfono destino
 * @param {string} [params.from] - Número remitente (opcional, se elige al azar si no se proporciona)
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
const sendCouponViaWhatsapp = async ({ couponId, phone, from }) => {
  try {
    const coupon = await prisma.campaignCoupon.findUnique({
      where: { id: couponId }
    });

    if (!coupon) {
      throw new Error(`Coupon not found: ${couponId}`);
    }

    // Obtener el template del cupón
    const template = await prisma.couponTemplate.findUnique({
      where: { couponType: coupon.couponType }
    });

    if (!template) {
      throw new Error(`Template not found for coupon type: ${coupon.couponType}`);
    }

    // Si no se proporciona número remitente, obtener uno al azar de Baileys
    let fromPhone = from;
    if (!fromPhone) {
      fromPhone = await whatsappService.getRandomConnectedSession();
      if (!fromPhone) {
        throw new Error("No connected WhatsApp sessions available in Baileys");
      }
      logger.info("Selected random WhatsApp session", {
        fromPhone,
        couponId
      });
    }

    // Renderizar el mensaje con los datos del cupón
    const message = renderCouponMessage(template, coupon);

    // Enviar via Baileys
    const baileyResult = await axios.post(
      `${BAILEYS_URL}/api/messages/send`,
      {
        from: fromPhone,
        to: phone,
        message: message,
        mediaUrl: template.mediaUrl,
        mediaType: "image"
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": BAILEYS_API_KEY || ""
        }
      }
    );

    if (baileyResult.data?.success) {
      // Actualizar el cupón con el estado de envío
      await prisma.campaignCoupon.update({
        where: { id: couponId },
        data: {
          status: "SENT",
          sentAt: new Date(),
          sentFrom: fromPhone,
          messageId: baileyResult.data?.data?.key?.id
        }
      });

      logger.info("Coupon sent via WhatsApp", {
        couponId,
        couponCode: coupon.code,
        phone,
        fromPhone,
        messageId: baileyResult.data?.data?.key?.id
      });

      return {
        success: true,
        messageId: baileyResult.data?.data?.key?.id,
        fromPhone
      };
    } else {
      throw new Error(baileyResult.data?.error || "Failed to send WhatsApp message via Baileys");
    }
  } catch (error) {
    logger.error("Error sending coupon via WhatsApp", {
      couponId,
      phone,
      error: error.message
    });
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Envía múltiples cupones a un contacto de campaña
 * @param {object} params
 * @param {string} params.campaignContactId - ID del contacto de campaña
 * @param {string[]} params.couponIds - Array de IDs de cupones a enviar
 * @param {string} [params.from] - Número remitente
 * @returns {Promise<{success: boolean, sent: number, failed: number, results: Array}>}
 */
const sendCouponsToCampaignContact = async ({ campaignContactId, couponIds, from }) => {
  try {
    const contact = await prisma.campaignContact.findUnique({
      where: { id: campaignContactId },
      include: { campaign: true }
    });

    if (!contact) {
      throw new Error(`Campaign contact not found: ${campaignContactId}`);
    }

    const phone = contact.establishmentPhone;
    if (!phone) {
      throw new Error(`No phone number for contact: ${campaignContactId}`);
    }

    const results = [];
    let sent = 0;
    let failed = 0;

    for (const couponId of couponIds) {
      const result = await sendCouponViaWhatsapp({
        couponId,
        phone,
        from
      });

      results.push({
        couponId,
        success: result.success,
        messageId: result.messageId,
        error: result.error
      });

      if (result.success) {
        sent++;
      } else {
        failed++;
      }
    }

    // Actualizar el estado del contacto si todos se enviaron
    if (failed === 0 && sent > 0) {
      await prisma.campaignContact.update({
        where: { id: campaignContactId },
        data: {
          status: "SENT",
          sentAt: new Date()
        }
      });
    }

    logger.info("Coupons sent to campaign contact", {
      campaignContactId,
      phone,
      sent,
      failed,
      total: couponIds.length
    });

    return {
      success: failed === 0,
      sent,
      failed,
      results
    };
  } catch (error) {
    logger.error("Error sending coupons to campaign contact", {
      campaignContactId,
      error: error.message
    });
    return {
      success: false,
      sent: 0,
      failed: couponIds.length,
      error: error.message,
      results: []
    };
  }
};

/**
 * Genera y envía un cupón en una sola operación
 * @param {object} params - Parámetros de generación y envío
 * @param {string} params.phone - Teléfono destino
 * @param {string} params.prospectName - Nombre del prospecto
 * @param {string} params.businessName - Nombre del negocio
 * @param {string} params.scenario - Escenario del cupón
 * @param {string} params.agentId - ID del agente
 * @param {string} params.callId - ID de la llamada
 * @param {string} [params.campaignId] - ID de la campaña
 * @param {string} [params.campaignContactId] - ID del contacto de campaña
 * @param {string} [params.couponType] - Tipo de cupón específico
 * @param {string} [params.from] - Número remitente WhatsApp (opcional, se elige al azar si no se proporciona)
 * @returns {Promise<{success: boolean, coupon?: object, messageId?: string, fromPhone?: string, error?: string}>}
 */
const generateAndSendCoupon = async ({
  phone,
  prospectName,
  businessName,
  scenario,
  agentId,
  callId,
  campaignId = null,
  campaignContactId = null,
  couponType = null,
  from = null
}) => {
  try {
    // 1. Generar el cupón
    const { coupon, message, template } = await couponGeneratorService.generateCouponForCall({
      phone,
      prospectName,
      businessName,
      scenario,
      agentId,
      callId,
      campaignId,
      campaignContactId,
      couponType
    });

    logger.info("Coupon generated, sending via WhatsApp", {
      couponId: coupon.id,
      couponCode: coupon.code,
      phone
    });

    // 2. Si no se proporciona número remitente, obtener uno al azar de Baileys
    let fromPhone = from;
    if (!fromPhone) {
      fromPhone = await whatsappService.getRandomConnectedSession();
      if (!fromPhone) {
        throw new Error("No connected WhatsApp sessions available in Baileys");
      }
      logger.info("Selected random WhatsApp session for coupon send", {
        fromPhone,
        couponId: coupon.id
      });
    }

    // 3. Enviar via Baileys
    const baileyResult = await axios.post(
      `${BAILEYS_URL}/api/messages/send`,
      {
        from: fromPhone,
        to: phone,
        message: message,
        mediaUrl: template.mediaUrl,
        mediaType: "image"
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": BAILEYS_API_KEY || ""
        }
      }
    );

    if (!baileyResult.data?.success) {
      throw new Error(baileyResult.data?.error || "Failed to send WhatsApp message via Baileys");
    }

    // 4. Actualizar el cupón con estado de envío
    const sentCoupon = await prisma.campaignCoupon.update({
      where: { id: coupon.id },
      data: {
        status: "SENT",
        sentAt: new Date()
      }
    });

    logger.info("Coupon generated and sent successfully", {
      couponId: coupon.id,
      couponCode: coupon.code,
      phone,
      fromPhone,
      messageId: baileyResult.data?.data?.key?.id
    });

    return {
      success: true,
      coupon: sentCoupon,
      messageId: baileyResult.data?.data?.key?.id,
      fromPhone
    };
  } catch (error) {
    logger.error("Error generating and sending coupon", {
      phone,
      scenario,
      error: error.message
    });
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Renderiza el mensaje de cupón con variables personalizadas
 * @param {object} template - Template del cupón
 * @param {object} coupon - Datos del cupón
 * @returns {string} Mensaje renderizado
 */
const renderCouponMessage = (template, coupon) => {
  let message = template.messageTemplate || "";

  // Reemplazar variables — coupon.code ya es limpio (ej: EASY-PLUS30)
  message = message.replace(/{{codigo}}/g, coupon.code);
  message = message.replace(/{{beneficio}}/g, coupon.offer || template.description || template.name);
  message = message.replace(/{{nombre}}/g, coupon.assignedPhone || "Prospecto");
  message = message.replace(/{{negocio}}/g, "Establecimiento");

  return message;
};

/**
 * Reenvía un cupón existente
 * @param {string} couponId - ID del cupón
 * @param {string} phone - Número de teléfono
 * @param {string} [from] - Número remitente
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
const resendCoupon = async (couponId, phone, from = null) => {
  try {
    const coupon = await prisma.campaignCoupon.findUnique({
      where: { id: couponId }
    });

    if (!coupon) {
      throw new Error(`Coupon not found: ${couponId}`);
    }

    const template = await prisma.couponTemplate.findUnique({
      where: { couponType: coupon.couponType }
    });

    if (!template) {
      throw new Error(`Template not found for coupon type: ${coupon.couponType}`);
    }

    const message = renderCouponMessage(template, coupon);

    const result = await whatsappService.sendWhatsAppMessage({
      to: phone,
      message,
      mediaUrl: template.mediaUrl,
      mediaType: "image",
      from
    });

    if (!result.success) {
      throw new Error(result.error || "Failed to send WhatsApp message");
    }

    // Actualizar el cupón
    await prisma.campaignCoupon.update({
      where: { id: couponId },
      data: {
        status: "SENT",
        sentAt: new Date()
      }
    });

    logger.info("Coupon resent via WhatsApp", {
      couponId,
      couponCode: coupon.code,
      phone
    });

    return {
      success: true,
      messageId: result.data?.key?.id
    };
  } catch (error) {
    logger.error("Error resending coupon", {
      couponId,
      phone,
      error: error.message
    });
    return {
      success: false,
      error: error.message
    };
  }
};

module.exports = {
  sendCouponViaWhatsapp,
  sendCouponsToCampaignContact,
  generateAndSendCoupon,
  resendCoupon,
  renderCouponMessage
};
