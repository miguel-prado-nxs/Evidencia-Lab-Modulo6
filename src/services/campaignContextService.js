const prisma = require("../config/database");
const logger = require("../config/logger");

/**
 * Construye el contexto de campaña para pasar a ElevenLabs
 * @param {string} campaignId - ID de la campaña
 * @param {string} campaignContactId - ID del contacto de campaña
 * @returns {Promise<object>} Contexto de campaña para ElevenLabs
 */
const buildCampaignContext = async (campaignId, campaignContactId) => {
  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        _count: {
          select: { coupons: true }
        }
      }
    });

    if (!campaign) {
      logger.warn("Campaign not found for context", { campaignId });
      return null;
    }

    const contact = campaignContactId ? await prisma.campaignContact.findUnique({
      where: { id: campaignContactId }
    }) : null;

    // Cargar templates de cupones
    let templates = [];
    if (campaign.couponTemplateIds && campaign.couponTemplateIds.length > 0) {
      templates = await prisma.couponTemplate.findMany({
        where: {
          id: { in: campaign.couponTemplateIds },
          active: true
        },
        select: {
          id: true,
          couponType: true,
          name: true,
          description: true,
          percentOff: true,
          durationMonths: true,
          trialDays: true,
          expiresHours: true,
          scenarios: true,
          messageTemplate: true,
          mediaUrl: true
        }
      });
    }

    const context = {
      campaignId: campaign.id,
      campaignName: campaign.name,
      campaignType: campaign.type,
      campaignStatus: campaign.status,
      campaignOffer: campaign.offer,
      
      // Información del contacto
      contactId: contact?.id || null,
      establishmentName: contact?.establishmentName || null,
      establishmentPhone: contact?.establishmentPhone || null,
      
      // Información de cupones
      coupons: {
        available: templates.length > 0,
        templates: templates.map(t => ({
          id: t.id,
          type: t.couponType,
          name: t.name,
          description: t.description,
          offer: `${t.percentOff ? t.percentOff + '%' : ''} ${t.durationMonths ? t.durationMonths + ' meses' : ''} ${t.trialDays ? t.trialDays + ' días trial' : ''}`.trim(),
          percentOff: t.percentOff,
          durationMonths: t.durationMonths,
          trialDays: t.trialDays,
          expiresHours: t.expiresHours,
          applicableScenarios: t.scenarios,
          messageTemplate: t.messageTemplate,
          mediaUrl: t.mediaUrl
        })),
        totalGenerated: campaign._count.coupons,
        sendInstructions: buildCouponSendInstructions(templates)
      },
      
      // Instrucciones para el agente
      agentInstructions: buildAgentInstructions(campaign, templates),
      
      // Metadata para tracking
      metadata: {
        createdAt: campaign.createdAt,
        startedAt: campaign.startedAt,
        agentConfigId: campaign.agentConfigId,
        agentConfigName: campaign.agentConfigName
      }
    };

    logger.info("Campaign context built for ElevenLabs", {
      campaignId,
      contactId: contact?.id,
      templatesAvailable: templates.length
    });

    return context;
  } catch (error) {
    logger.error("Error building campaign context", {
      campaignId,
      campaignContactId,
      error: error.message
    });
    return null;
  }
};

/**
 * Construye instrucciones de envío de cupones para el agente
 * @param {Array} templates - Templates de cupones disponibles
 * @returns {object} Instrucciones de envío
 */
const buildCouponSendInstructions = (templates) => {
  if (templates.length === 0) {
    return {
      enabled: false,
      message: "No hay cupones disponibles para esta campaña"
    };
  }

  return {
    enabled: true,
    trigger: "Al final de la llamada si el prospecto muestra interés",
    method: "whatsapp",
    templates: templates.map(t => ({
      type: t.couponType,
      name: t.name,
      scenarios: t.scenarios,
      instruction: `Enviar cupón ${t.couponType} (${t.name}) si el prospecto está interesado en ${t.scenarios.join(' o ')}`
    })),
    endpoint: "/api/v1/coupons-whatsapp/generate-and-send",
    requiredParams: [
      "phone",
      "prospectName",
      "businessName",
      "scenario",
      "agentId",
      "callId",
      "campaignId",
      "campaignContactId",
      "couponType"
    ]
  };
};

/**
 * Construye instrucciones para el agente de ElevenLabs
 * @param {object} campaign - Datos de la campaña
 * @param {Array} templates - Templates de cupones
 * @returns {string} Instrucciones para el agente
 */
const buildAgentInstructions = (campaign, templates) => {
  let instructions = `Eres un agente de ventas para la campaña: "${campaign.name}"\n\n`;
  
  if (campaign.description) {
    instructions += `Descripción: ${campaign.description}\n\n`;
  }

  if (campaign.offer) {
    instructions += `Oferta: ${campaign.offer}\n\n`;
  }

  if (templates.length > 0) {
    instructions += `CUPONES DISPONIBLES PARA ENVIAR:\n`;
    templates.forEach(t => {
      instructions += `- ${t.couponType} (${t.name}): ${t.description || 'Sin descripción'}\n`;
      instructions += `  Escenarios: ${t.scenarios.join(', ')}\n`;
      instructions += `  Beneficio: ${t.percentOff ? t.percentOff + '%' : ''} ${t.durationMonths ? t.durationMonths + ' meses' : ''} ${t.trialDays ? t.trialDays + ' días trial' : ''}\n`;
    });
    instructions += `\nAL FINAL DE LA LLAMADA: Si el prospecto está interesado, ofrece enviarle un cupón especial por WhatsApp.\n`;
    instructions += `Especifica qué tipo de cupón es más apropiado según el escenario de la conversación.\n`;
  }

  return instructions;
};

/**
 * Obtiene el contexto de campaña con instrucciones para ElevenLabs
 * @param {string} campaignId - ID de la campaña
 * @param {string} campaignContactId - ID del contacto
 * @returns {Promise<object>} Contexto completo
 */
const getCampaignContextForAgent = async (campaignId, campaignContactId) => {
  const context = await buildCampaignContext(campaignId, campaignContactId);
  
  if (!context) {
    return {
      success: false,
      error: "Campaign context not found"
    };
  }

  return {
    success: true,
    data: context
  };
};

/**
 * Enriquece las variables dinámicas para ElevenLabs con contexto de campaña
 * @param {object} dynamicVariables - Variables dinámicas existentes
 * @param {string} campaignId - ID de la campaña
 * @param {string} campaignContactId - ID del contacto
 * @returns {Promise<object>} Variables enriquecidas
 */
const enrichDynamicVariablesWithCampaignContext = async (
  dynamicVariables,
  campaignId,
  campaignContactId
) => {
  try {
    const context = await buildCampaignContext(campaignId, campaignContactId);
    
    if (!context) {
      return dynamicVariables;
    }

    return {
      ...dynamicVariables,
      campaignContext: context,
      couponsAvailable: context.coupons.available,
      couponTypes: context.coupons.templates.map(t => t.type),
      agentInstructions: context.agentInstructions,
      couponSendEndpoint: "/api/v1/coupons-whatsapp/generate-and-send"
    };
  } catch (error) {
    logger.error("Error enriching dynamic variables with campaign context", {
      campaignId,
      error: error.message
    });
    return dynamicVariables;
  }
};

/**
 * Construye el payload para pasar a ElevenLabs con contexto de campaña
 * @param {object} recipient - Datos del recipiente
 * @param {string} campaignId - ID de la campaña
 * @param {string} campaignContactId - ID del contacto
 * @returns {Promise<object>} Payload enriquecido
 */
const buildElevenLabsPayloadWithCampaignContext = async (
  recipient,
  campaignId,
  campaignContactId
) => {
  try {
    const enrichedVariables = await enrichDynamicVariablesWithCampaignContext(
      recipient.dynamic_variables || {},
      campaignId,
      campaignContactId
    );

    return {
      ...recipient,
      dynamic_variables: enrichedVariables
    };
  } catch (error) {
    logger.error("Error building ElevenLabs payload with campaign context", {
      campaignId,
      error: error.message
    });
    return recipient;
  }
};

module.exports = {
  buildCampaignContext,
  getCampaignContextForAgent,
  enrichDynamicVariablesWithCampaignContext,
  buildElevenLabsPayloadWithCampaignContext,
  buildCouponSendInstructions,
  buildAgentInstructions
};
