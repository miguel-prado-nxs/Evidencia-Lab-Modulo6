const prisma = require("../config/database");
const logger = require("../config/logger");
const crypto = require("crypto");

const URL_MICROSTRIPE = process.env.MICROSTRIPE || "http://localhost:3002/api/stripe"; 

const { URL } = require('url');
const http = require('http');
const https = require('https');

const postJson = (urlString, data) => {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(urlString);
      const lib = url.protocol === 'https:' ? https : http;
      const body = JSON.stringify(data);

      const req = lib.request(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let chunks = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (chunks += chunk));
          res.on('end', () => {
            try {
              const parsed = chunks ? JSON.parse(chunks) : null;
              if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve(parsed);
              } else {
                const err = new Error(`HTTP ${res.statusCode}`);
                err.status = res.statusCode;
                err.body = parsed;
                reject(err);
              }
            } catch (e) {
              reject(e);
            }
          });
        }
      );

      req.on('error', (err) => reject(err));
      req.write(body);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
};

/**
 * Genera un código de cupón único con formato: BASE-SUFFIX
 * @param {string} base - Base del código (ej: "EASY-PLUS30")
 * @param {string} [contactId] - ID de contacto opcional para asegurar unicidad
 * @returns {string} Código único (ej: "EASY-PLUS30-A3F2X9")
 */
const generateUniqueCode = (base, contactId = null) => {
  const suffix = contactId ? contactId.slice(-4).toUpperCase() : crypto.randomBytes(2).toString("hex").toUpperCase();
  return `${base}-${suffix}`;
};

/**
 * Renderiza una plantilla de mensaje con variables
 * @param {string} template - Plantilla con variables {{variable}}
 * @param {object} data - Datos para reemplazar
 * @returns {string} Mensaje renderizado
 */
const renderTemplate = (template, data) => {
  let rendered = template;

  Object.keys(data).forEach(key => {
    const regex = new RegExp(`{{${key}}}`, 'g');
    rendered = rendered.replace(regex, data[key] || '');
  });

  return rendered;
};

/**
 * Verifica si un usuario puede recibir un cupón
 * @param {string} phone - Teléfono del usuario
 * @param {string} couponType - Tipo de cupón
 * @returns {Promise<{eligible: boolean, reason?: string}>}
 */
const checkEligibility = async (phone, couponType) => {
  // Obtener template para verificar reglas
  const template = await prisma.couponTemplate.findUnique({
    where: { couponType }
  });

  if (!template) {
    return { eligible: false, reason: "Template not found" };
  }

  // Lógica de validación deshabilitada a petición del usuario.
  // Permite enviar cuantos cupones se requieran sin limitar por usuario.
  return { eligible: true };
};

/**
 * Selecciona el template apropiado basado en el tipo de cupón
 * @param {string} couponType - Tipo de cupón (ej: "PLUS30", "50OFF")
 * @returns {Promise<object>} Template seleccionado
 */
const selectTemplateByCouponType = async (couponType) => {
  const template = await prisma.couponTemplate.findFirst({
    where: {
      couponType,
      active: true
    }
  });

  if (!template) {
    throw new Error(`No active template found for couponType: ${couponType}`);
  }

  return template;
};

/**
 * Selecciona el template apropiado basado en el escenario
 * @param {string} scenario - Escenario (ej: "bant_high", "price_objection")
 * @param {object} bantScores - Puntajes BANT opcionales
 * @returns {Promise<object>} Template seleccionado
 */
const selectTemplateByScenario = async (scenario, bantScores = {}) => {
  // Buscar templates que incluyan este escenario
  const templates = await prisma.couponTemplate.findMany({
    where: {
      active: true,
      scenarios: {
        has: scenario
      }
    },
    orderBy: {
      priority: 'desc'
    }
  });

  if (templates.length === 0) {
    throw new Error(`No active template found for scenario: ${scenario}`);
  }

  // Por ahora retornamos el de mayor prioridad
  // En el futuro se puede agregar lógica más compleja basada en BANT
  return templates[0];
};

/**
 * Genera un cupón para una llamada de agente
 * @param {object} params - Parámetros de generación
 * @param {string} params.phone - Teléfono del prospecto
 * @param {string} params.prospectName - Nombre del prospecto
 * @param {string} params.businessName - Nombre del negocio
 * @param {string} params.scenario - Escenario que dispara el cupón (opcional si viene couponType)
 * @param {object} params.bantScores - Puntajes BANT (opcional)
 * @param {string} params.agentId - ID del agente que genera el cupón
 * @param {string} params.callId - ID de la llamada
 * @param {string} params.campaignId - ID de campaña (opcional)
 * @param {string} params.campaignContactId - ID del contacto de campaña para trazabilidad (opcional)
 * @param {string} params.couponType - Tipo de cupón directo desde campaignContext (opcional)
 * @returns {Promise<{coupon: object, message: string, template: object}>}
 */
const generateCouponForCall = async ({
  phone,
  prospectName,
  businessName,
  scenario,
  bantScores = {},
  agentId,
  callId,
  campaignId = null,
  campaignContactId = null,
  couponType = null
}) => {
  // 1. Seleccionar template: prioridad a couponType, fallback a scenario
  let template;
  if (couponType) {
    template = await selectTemplateByCouponType(couponType);
    logger.info("Template selected strictly by couponType (scenario used for analytics only)", {
      couponType,
      templateId: template.id,
      scenario
    });
  } else if (scenario) {
    template = await selectTemplateByScenario(scenario, bantScores);
    logger.info("Template selected by scenario", { scenario, templateId: template.id });
  } else {
    throw new Error("Either couponType or scenario is required to select a template");
  }

  // 2. Verificar elegibilidad
  const eligibility = await checkEligibility(phone, template.couponType);
  if (!eligibility.eligible) {
    throw new Error(eligibility.reason);
  }

  // 3. El código del cupón es EASY-{couponType}-XXXX (ej: EASY-PLUS30-A3F2)
  // Sufijo basado en el ID del contacto para garantizar unicidad
  const baseCode = `EASY-${template.couponType}`;
  const code = generateUniqueCode(baseCode, campaignContactId);

  // 4. Calcular fecha de expiración
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + template.expiresHours);

  // 5. Crear cupón con trazabilidad de campaña
  const coupon = await prisma.campaignCoupon.create({
    data: {
      code,
      campaignId,
      campaignContactId, // Trazabilidad directa al contacto de campaña
      couponType: template.couponType,
      offer: template.description || `${template.name}`,
      percentOff: template.percentOff,
      durationMonths: template.durationMonths,
      trialDays: template.trialDays,
      scenario,
      assignedPhone: phone,
      assignedAt: new Date(),
      expiresAt,
      source: 'agent_call',
      agentId,
      callId,
      status: 'GENERATED'
    }
  });

  // Creacion de codigo promocional en stripe
  try {
    // Buscar stripe_coupon_id desde el template en BD (por couponType)
    const tpl = await prisma.couponTemplate.findUnique({
      where: { couponType: template.couponType }
    });

    const stripeCouponId = tpl && (tpl.stripe_coupon_id || tpl.stripeCouponId || tpl.stripeCouponId);

    if (stripeCouponId) {
      const endpoint = `${URL_MICROSTRIPE.replace(/\/$/, '')}/coupons/insertCodePromotionToCoupon`;
      const payload = {
        idCoupon: stripeCouponId,
        code,
        expiresAt: expiresAt.toISOString(),
      };

      try {
        const result = await postJson(endpoint, payload);
        logger.info('Promotion code created in microstripe', { couponId: stripeCouponId, code, result });
      } catch (err) {
        logger.warn('Failed to create promotion code in microstripe', { couponId: stripeCouponId, code, error: err.message || err });
      }
    } else {
      logger.warn('No stripe_coupon_id found for template; skipping promotion code creation', { couponType: template.couponType });
    }
  } catch (err) {
    logger.error('Error creating promotion code for coupon', { error: err.message || err });
  }


  // 6. Personalizar mensaje con datos del prospecto
  // codigo = couponType limpio (ej: PLUS30) — lo que ve el cliente
  // couponId = UUID interno — para enlaces de rastreo individual
  const message = renderTemplate(template.messageTemplate, {
    nombre: prospectName,
    negocio: businessName,
    codigo: code,
    couponId: coupon.id,
    beneficio: template.description || template.name
  });

  logger.info(`Coupon generated for call`, {
    couponId: coupon.id,
    code: coupon.code,
    phone,
    scenario,
    couponType: template.couponType,
    agentId,
    callId,
    campaignId,
    campaignContactId
  });

  return {
    coupon,
    message,
    template: {
      mediaUrl: template.mediaUrl
    }
  };
};

/**
 * Genera cupones en bulk para una campaña
 * @param {string} campaignId - ID de la campaña
 * @param {string} couponType - Tipo de cupón
 * @param {number} count - Cantidad a generar
 * @returns {Promise<Array>} Cupones generados
 */
const generateBulkCouponsForCampaign = async (campaignId, couponType, count) => {
  if (count < 1 || count > 1000) {
    throw new Error("Count must be between 1 and 1000");
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId }
  });

  if (!campaign) {
    throw new Error("Campaign not found");
  }

  const template = await prisma.couponTemplate.findUnique({
    where: { couponType }
  });

  if (!template) {
    throw new Error(`Template not found for type: ${couponType}`);
  }

  const coupons = [];
  const baseCode = `EASY-${couponType}`;

  for (let i = 0; i < count; i++) {
    let attempts = 0;
    let code;
    let isUnique = false;

    while (!isUnique && attempts < 10) {
      code = generateUniqueCode(baseCode);
      const existing = await prisma.campaignCoupon.findUnique({
        where: { code }
      });
      if (!existing) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      throw new Error(`Failed to generate unique coupon code after ${attempts} attempts`);
    }

    const coupon = await prisma.campaignCoupon.create({
      data: {
        campaignId,
        code,
        couponType: template.couponType,
        offer: template.description || template.name,
        percentOff: template.percentOff,
        durationMonths: template.durationMonths,
        trialDays: template.trialDays,
        source: 'campaign',
        status: 'GENERATED'
      }
    });

    coupons.push(coupon);
  }

  logger.info(`Generated ${coupons.length} coupons for campaign ${campaignId}`);
  return coupons;
};

/**
 * Valida y redime un cupón
 * @param {string} code - Código del cupón
 * @param {object} userData - Datos del usuario que redime
 * @returns {Promise<object>} Cupón redimido con configuración Stripe
 */
const redeemCoupon = async (code, userData = {}) => {
  const coupon = await prisma.campaignCoupon.findUnique({
    where: { code }
  });

  if (!coupon) {
    throw new Error("Coupon not found");
  }

  if (coupon.status === 'CONVERTED') {
    throw new Error("Coupon already redeemed");
  }

  if (coupon.status === 'EXPIRED') {
    throw new Error("Coupon expired");
  }

  // Verificar expiración
  if (coupon.expiresAt && new Date() > coupon.expiresAt) {
    await prisma.campaignCoupon.update({
      where: { id: coupon.id },
      data: { status: 'EXPIRED' }
    });
    throw new Error("Coupon expired");
  }

  // Marcar como convertido
  const updatedCoupon = await prisma.campaignCoupon.update({
    where: { id: coupon.id },
    data: {
      status: 'CONVERTED',
      convertedAt: new Date(),
      conversionData: userData
    }
  });

  logger.info(`Coupon redeemed: ${code}`, {
    couponId: coupon.id,
    userData
  });

  // Retornar configuración para Stripe
  return {
    coupon: updatedCoupon,
    stripeConfig: {
      percentOff: coupon.percentOff,
      durationMonths: coupon.durationMonths,
      trialDays: coupon.trialDays
    }
  };
};

module.exports = {
  generateCouponForCall,
  generateBulkCouponsForCampaign,
  redeemCoupon,
  checkEligibility,
  selectTemplateByScenario,
  selectTemplateByCouponType,
  renderTemplate
};
