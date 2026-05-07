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
          // active: true Lo quitamos para que no ignore cupones desactivados temporalmente si ya estaban asignados
        },
        orderBy: {
          priority: 'desc'
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

    // Identificar el tipo principal real (evitar que un UUID pase como código de cupón)
    let resolvedPrimaryType = null;
    const primaryTemplate = templates.find(t => t.id === campaign.couponPrefix || t.couponType === campaign.couponPrefix);

    if (primaryTemplate) {
      resolvedPrimaryType = primaryTemplate.couponType;
    } else if (templates.length > 0) {
      resolvedPrimaryType = templates[0].couponType;
    } else if (campaign.couponPrefix && !/^[0-9a-f]{8}-/i.test(campaign.couponPrefix)) {
      resolvedPrimaryType = campaign.couponPrefix;
    } else {
      // Si era un UUID y no lo encontró en ids asociados, busquémoslo explícitamente en la BD
      if (campaign.couponPrefix && /^[0-9a-f]{8}-/i.test(campaign.couponPrefix)) {
        const dbTemplate = await prisma.couponTemplate.findFirst({ where: { id: campaign.couponPrefix } });
        if (dbTemplate) {
          resolvedPrimaryType = dbTemplate.couponType;
          templates.push(dbTemplate);
        }
      }
    }

    if (!resolvedPrimaryType) resolvedPrimaryType = 'PRINCIPAL';

    // FALLBACK DE SEGURIDAD
    // Si a pesar de todo no hallamos templates, inyectamos uno default
    if (templates.length === 0) {
      templates.push({
        id: 'legacy-fallback',
        couponType: resolvedPrimaryType,
        name: `Cupón Principal (${resolvedPrimaryType})`,
        description: campaign.offer || 'Cupón de campaña por defecto',
        percentOff: null,
        durationMonths: null,
        trialDays: null,
        expiresHours: null,
        scenarios: ['first_contact', 'high_intent'],
        messageTemplate: '',
        mediaUrl: ''
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
        couponType: resolvedPrimaryType,
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
        sendInstructions: buildCouponSendInstructions(templates, resolvedPrimaryType)
      },

      // Instrucciones para el agente
      agentInstructions: buildAgentInstructions(campaign, templates, resolvedPrimaryType),

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
const buildCouponSendInstructions = (templates, campaignCouponType = null) => {
  if (templates.length === 0) {
    return {
      enabled: false,
      message: "No hay cupones disponibles para esta campaña"
    };
  }

  const primaryType = campaignCouponType || templates[0]?.couponType;

  return {
    enabled: true,
    trigger: "Al final de la llamada si el prospecto muestra interés",
    method: "whatsapp",
    couponType: primaryType,
    templates: templates.map(t => ({
      type: t.couponType,
      name: t.name,
      scenarios: t.scenarios,
      instruction: `Enviar cupón ${t.couponType} (${t.name}) si el prospecto está interesado`
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
 * Soporta modo híbrido: cupón principal por defecto + alternativos por escenario
 * @param {object} campaign - Datos de la campaña
 * @param {Array} templates - Templates de cupones (primero = principal)
 * @returns {string} Instrucciones para el agente
 */
const buildAgentInstructions = (campaign, templates, resolvedPrimaryType) => {
  const primaryType = resolvedPrimaryType || templates[0]?.couponType;
  const primaryTemplate = templates.find(t => t.couponType === primaryType) || templates[0];
  const alternativeTemplates = templates.filter(t => t.couponType !== primaryType);
  const isHybrid = alternativeTemplates.length > 0;

  let instructions = `Campaña activa: "${campaign.name}"\n`;

  if (campaign.offer) {
    instructions += `Oferta de campaña: ${campaign.offer}\n`;
  }

  instructions += `\n`;

  if (templates.length === 0) {
    instructions += `No hay cupones disponibles para esta campaña.\n`;
    return instructions;
  }

  if (isHybrid) {
    // Modo híbrido: principal + alternativos con selección inteligente
    instructions += `SELECCIÓN DE CUPONES (MODO HÍBRIDO)\n`;
    instructions += `${'='.repeat(45)}\n\n`;

    instructions += `CUPÓN PRINCIPAL (usar por defecto):\n`;
    instructions += `  Tipo: ${primaryTemplate.couponType}\n`;
    instructions += `  Nombre: ${primaryTemplate.name}\n`;
    instructions += `  Beneficio: ${_formatOffer(primaryTemplate)}\n`;
    if (primaryTemplate.scenarios?.length > 0) {
      instructions += `  Escenarios: ${primaryTemplate.scenarios.join(', ')}\n`;
    }

    instructions += `\nCUPONES ALTERNATIVOS (usar SOLO si el contexto lo justifica):\n`;
    alternativeTemplates.forEach(t => {
      instructions += `\n  [${t.couponType}] ${t.name}\n`;
      instructions += `  Beneficio: ${_formatOffer(t)}\n`;
      if (t.scenarios?.length > 0) {
        instructions += `  Activar cuando: ${t.scenarios.join(' | ')}\n`;
      }
    });

    instructions += `\nÁRBOL DE DECISIÓN:\n`;
    instructions += `  price_objection → Busca un alternativo con ese escenario (ej: 50OFF)\n`;
    instructions += `  upgrade_interest / multiple_branches → Busca alternativo de upgrade (ej: UPGRADEPRO)\n`;
    instructions += `  trial_ending / active_free_user → Busca alternativo de trial (ej: TRIAL14)\n`;
    instructions += `  referral → Busca alternativo de referido (ej: REFER)\n`;
    instructions += `  abandoned_conversation / cold_lead → Busca alternativo de recuperación (ej: COMEBACK)\n`;
    instructions += `  Cualquier otro caso → Usa el PRINCIPAL: ${primaryType}\n`;

    instructions += `\nREGLAS OBLIGATORIAS:\n`;
    instructions += `  1. Por defecto SIEMPRE ofrece el cupón PRINCIPAL: ${primaryType}\n`;
    instructions += `  2. Solo cambia a alternativo si la conversación encaja claramente en su escenario\n`;
    instructions += `  3. NUNCA inventes un couponType que no esté en la lista anterior\n`;
    instructions += `  4. NUNCA envíes el cupón sin confirmación verbal del prospecto\n`;
    instructions += `  5. Envía solo UN cupón por llamada\n`;
  } else {
    // Modo simple: un solo cupón
    instructions += `CUPÓN A ENVIAR:\n`;
    instructions += `  Tipo: ${primaryTemplate.couponType}\n`;
    instructions += `  Nombre: ${primaryTemplate.name}\n`;
    instructions += `  Beneficio: ${_formatOffer(primaryTemplate)}\n`;
    if (primaryTemplate.scenarios?.length > 0) {
      instructions += `  Escenarios: ${primaryTemplate.scenarios.join(', ')}\n`;
    }
    instructions += `\nAL FINAL DE LA LLAMADA: Si el prospecto está interesado, ofrece enviarle el cupón ${primaryTemplate.couponType} por WhatsApp.\n`;
    instructions += `Usa siempre couponType: "${primaryTemplate.couponType}". El campo 'scenario' es solo para analíticas.\n`;
  }

  instructions += `\nPARAMETROS DEL WEBHOOK:\n`;
  instructions += `  couponType: [tipo elegido según árbol de decisión]\n`;
  instructions += `  scenario: [escenario detectado en la conversación]\n`;
  instructions += `  phone, prospectName, businessName, agentId, callId, campaignId, campaignContactId\n`;

  return instructions;
};

/**
 * Formatea la oferta de un template en texto legible
 * @param {object} template
 * @returns {string}
 */
const _formatOffer = (template) => {
  const parts = [];
  if (template.percentOff) parts.push(`${template.percentOff}% descuento`);
  if (template.durationMonths) parts.push(`${template.durationMonths} mes(es)`);
  if (template.trialDays) parts.push(`${template.trialDays} días trial`);
  return parts.length > 0 ? parts.join(' + ') : (template.description || template.name);
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
      couponType: context.coupons.couponType,
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
