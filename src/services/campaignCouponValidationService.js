const prisma = require('../config/database');
const logger = require('../config/logger');

/**
 * Carga y valida los templates de cupones seleccionados para una campaña
 * @param {string[]} couponTemplateIds - Array de IDs de templates
 * @returns {Promise<{templates: Array, validation: Object}>}
 */
const loadAndValidateCouponTemplates = async (couponTemplateIds = []) => {
  if (!Array.isArray(couponTemplateIds) || couponTemplateIds.length === 0) {
    return {
      templates: [],
      validation: {
        isValid: true,
        warnings: [],
        errors: [],
        summary: 'No templates selected',
      },
    };
  }

  const templates = await prisma.couponTemplate.findMany({
    where: {
      id: { in: couponTemplateIds },
      active: true,
    },
  });

  const validation = {
    isValid: true,
    warnings: [],
    errors: [],
    summary: '',
  };

  // Validar que todos los templates existan
  if (templates.length !== couponTemplateIds.length) {
    const foundIds = new Set(templates.map((t) => t.id));
    const missingIds = couponTemplateIds.filter((id) => !foundIds.has(id));
    validation.errors.push(`Templates no encontrados: ${missingIds.join(', ')}`);
    validation.isValid = false;
  }

  // Validar que no haya templates duplicados
  const uniqueTypes = new Set(templates.map((t) => t.couponType));
  if (uniqueTypes.size !== templates.length) {
    validation.warnings.push('Hay templates con el mismo couponType');
  }

  // Validar configuración de cada template
  templates.forEach((template, index) => {
    if (!template.messageTemplate) {
      validation.errors.push(
        `Template ${index + 1} (${template.couponType}): messageTemplate vacío`
      );
      validation.isValid = false;
    }
    if (!template.percentOff && !template.trialDays) {
      validation.warnings.push(`Template ${template.couponType}: Sin descuento ni días de trial`);
    }
    if (template.expiresHours < 1) {
      validation.warnings.push(
        `Template ${template.couponType}: Expira muy rápido (${template.expiresHours}h)`
      );
    }
  });

  validation.summary = `${templates.length} template(s) cargado(s). ${validation.errors.length} error(es), ${validation.warnings.length} advertencia(s)`;

  logger.info('Coupon templates validated', {
    templateCount: templates.length,
    isValid: validation.isValid,
    errors: validation.errors.length,
    warnings: validation.warnings.length,
  });

  return {
    templates,
    validation,
  };
};

/**
 * Obtiene vista previa de qué se enviará en la campaña
 * @param {string} campaignId - ID de la campaña
 * @returns {Promise<Object>} Vista previa de envío
 */
const getCampaignSendPreview = async (campaignId) => {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      _count: {
        select: {
          contacts: true,
          coupons: true,
        },
      },
    },
  });

  if (!campaign) {
    throw new Error('Campaign not found');
  }

  // Cargar templates
  const { templates, validation } = await loadAndValidateCouponTemplates(
    campaign.couponTemplateIds || []
  );

  // Obtener muestra de contactos
  const sampleContacts = await prisma.campaignContact.findMany({
    where: { campaignId },
    take: 3,
    select: {
      id: true,
      establishmentName: true,
      establishmentPhone: true,
      establishmentData: true,
    },
  });

  // Generar vista previa de mensajes
  const messagePreview = sampleContacts.map((contact) => {
    const contactData = contact.establishmentData || {};
    const prospectName =
      contactData.decisionMakerName ||
      contactData.contactName ||
      contact.establishmentName ||
      'Prospecto';
    const businessName = contact.establishmentName || 'Establecimiento';

    const messages = templates.map((template) => {
      const message = template.messageTemplate
        .replace(/{{nombre}}/g, prospectName)
        .replace(/{{negocio}}/g, businessName)
        .replace(/{{codigo}}/g, 'EASY-XXXX-XXXX');

      return {
        templateId: template.id,
        couponType: template.couponType,
        templateName: template.name,
        preview: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
        fullMessage: message,
        offer: template.description || template.name,
        percentOff: template.percentOff,
        durationMonths: template.durationMonths,
        trialDays: template.trialDays,
        expiresHours: template.expiresHours,
        mediaUrl: template.mediaUrl,
      };
    });

    return {
      contactId: contact.id,
      phone: contact.establishmentPhone,
      businessName,
      prospectName,
      messages,
    };
  });

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      totalContacts: campaign._count.contacts,
      totalCoupons: campaign._count.coupons,
    },
    templates: {
      selected: templates.length,
      list: templates.map((t) => ({
        id: t.id,
        couponType: t.couponType,
        name: t.name,
        description: t.description,
        percentOff: t.percentOff,
        durationMonths: t.durationMonths,
        trialDays: t.trialDays,
        expiresHours: t.expiresHours,
        priority: t.priority,
      })),
      validation,
    },
    messagePreview: {
      sampleSize: sampleContacts.length,
      samples: messagePreview,
    },
    summary: {
      totalContactsToReceive: campaign._count.contacts,
      totalTemplates: templates.length,
      totalMessagesPerContact: templates.length,
      estimatedTotalMessages: campaign._count.contacts * templates.length,
      isReadyToSend: validation.isValid && templates.length > 0 && campaign._count.contacts > 0,
    },
  };
};

/**
 * Valida que una campaña tenga templates antes de iniciar
 * @param {string} campaignId - ID de la campaña
 * @returns {Promise<{isValid: boolean, errors: Array}>}
 */
const validateCampaignBeforeStart = async (campaignId) => {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      couponTemplateIds: true,
      couponPrefix: true,
      _count: {
        select: { contacts: true },
      },
    },
  });

  if (!campaign) {
    return {
      isValid: false,
      errors: ['Campaign not found'],
    };
  }

  const errors = [];

  // Validar que tenga contactos
  if (campaign._count.contacts === 0) {
    errors.push('Campaign has no contacts assigned');
  }

  // Validar que tenga templates o couponPrefix
  const hasTemplates =
    Array.isArray(campaign.couponTemplateIds) && campaign.couponTemplateIds.length > 0;
  const hasPrefix = !!campaign.couponPrefix;

  if (!hasTemplates && !hasPrefix) {
    errors.push('Campaign must have coupon templates or coupon prefix selected');
  }

  // Si tiene templates, validarlos
  if (hasTemplates) {
    const { validation } = await loadAndValidateCouponTemplates(campaign.couponTemplateIds);
    if (!validation.isValid) {
      errors.push(...validation.errors);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

module.exports = {
  loadAndValidateCouponTemplates,
  getCampaignSendPreview,
  validateCampaignBeforeStart,
};
