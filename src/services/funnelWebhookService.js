/**
 * Funnel Webhook Service
 *
 * Lógica de negocio para los webhooks del funnel de agentes ElevenLabs.
 * Cubre Discovery, Activation, Qualification y Conversion.
 */

const prisma = require("../config/database");
const logger = require("../config/logger");
const { logEnrichmentEvent } = require("./enrichmentService");
const whatsappService = require("./whatsappService");

const AGENT_PARTNER_ID = process.env.AGENT_SYSTEM_PARTNER_ID || "AGENT_FUNNEL";

// Mapea outcomes de agentes al call_status permitido por el check constraint:
// ('completed', 'no_answer', 'voicemail', 'failed')
function toCallStatus(outcome) {
  if (!outcome) return "completed";
  const o = outcome.toUpperCase();
  if (o === "NO_ANSWER") return "no_answer";
  if (o === "VOICEMAIL") return "voicemail";
  if (o === "WRONG_NUMBER" || o === "FAILED") return "failed";
  return "completed";
}
const CALENDLY_TOKEN = process.env.CALENDLY_API_TOKEN;
const CALENDLY_EVENT_TYPE_URI =
  process.env.CALENDLY_EVENT_TYPE_URI ||
  "https://api.calendly.com/event_types/f68abb7b-2edf-40a9-b966-3b00da3152f9";

// Plan prices (MXN/month)
const PLAN_PRICES = {
  BASIC: 5999,
  PROFESSIONAL: 11999,
  ENTERPRISE: 19999,
};

// ============================================================
// HELPERS
// ============================================================

async function upsertEnrichmentSnapshot(establishmentId, stage, data) {
  const existing = await prisma.establishmentEnrichment.findUnique({
    where: { establishmentId },
  });
  const existingData = existing?.establishmentData || {};
  const updatedData = {
    ...existingData,
    [stage]: {
      ...(existingData[stage] || {}),
      ...data,
      updatedAt: new Date().toISOString(),
    },
  };
  await prisma.establishmentEnrichment.upsert({
    where: { establishmentId },
    create: { establishmentId, establishmentData: updatedData },
    update: { establishmentData: updatedData },
  });
}

// ============================================================
// WHATSAPP: Mensaje informativo básico (para Discovery)
// ============================================================

async function sendWhatsappInfo({
  conversationId,
  establishmentId,
  phone,
  prospectName,
  businessName,
}) {
  if (!phone) throw new Error("phone requerido");

  const saludo = prospectName ? `¡Hola ${prospectName}!` : "¡Hola!";

  const message =
    `${saludo}\n\n` +
    `Soy el asistente de EasyOrder. Ayudamos a negocios de comida a digitalizar y organizar mejor sus pedidos.\n\n` +
    `Visítanos para conocernos más en el siguiente enlace:\n` +
    `👉 https://easyorder.mx \n\n` +
    `¡Que tengas un buen día!`;

  const result = await whatsappService.sendWhatsAppMessage({
    to: phone,
    message,
  });

  logger.info("[FunnelWebhook:Discovery] sendWhatsappInfo", {
    phone,
    establishmentId,
    success: result.success,
  });

  return result;
}

// ============================================================
// DISCOVERY
// ============================================================

async function saveDiscoveryData({
  conversationId,
  establishmentId,
  contactName,
  businessType,
  painPoint,
  interestLevel,
  notes,
}) {
  if (!establishmentId) throw new Error("establishment_id requerido");

  const enrichmentUpdate = {};
  if (contactName) enrichmentUpdate.decisionMakerName = contactName;

  if (businessType || painPoint || interestLevel || notes) {
    await upsertEnrichmentSnapshot(establishmentId, "discovery", {
      conversationId,
      businessType,
      painPoint,
      interestLevel,
      notes,
    });
  } else if (Object.keys(enrichmentUpdate).length > 0) {
    await prisma.establishmentEnrichment.upsert({
      where: { establishmentId },
      create: { establishmentId, ...enrichmentUpdate },
      update: enrichmentUpdate,
    });
  }

  logger.info("[FunnelWebhook:Discovery] saveDiscoveryData", {
    establishmentId,
    contactName,
    interestLevel,
  });
  return { success: true };
}

async function endDiscoveryCall({
  conversationId,
  establishmentId,
  outcome,
  contactName,
  businessType,
  painPoint,
  interestLevel,
  callSummary,
}) {
  if (!establishmentId) throw new Error("establishment_id requerido");

  // 1. Guardar datos finales
  await saveDiscoveryData({
    conversationId,
    establishmentId,
    contactName,
    businessType,
    painPoint,
    interestLevel,
    notes: callSummary,
  });

  // 2. Actualizar callSummary y callStatus en enrichment
  await prisma.establishmentEnrichment.upsert({
    where: { establishmentId },
    create: {
      establishmentId,
      callSummary,
      callStatus: toCallStatus(outcome),
      enrichmentStatus: "discovery_completed",
    },
    update: {
      callSummary,
      callStatus: toCallStatus(outcome),
      enrichmentStatus: "discovery_completed",
    },
  });

  // 3. Log en campaign_enrichments (non-blocking)
  logEnrichmentEvent({
    establishmentId,
    source: "CAMPAIGN",
    conversationId,
    agentStage: "DISCOVERY",
    levelReached: interestLevel === "HIGH" ? "PROSPECT" : "CONTACT",
    enrichmentSnapshot: {
      outcome,
      contactName,
      businessType,
      painPoint,
      interestLevel,
      callSummary,
    },
    enrichedByType: "AGENT",
    notes: `Discovery outcome: ${outcome}`,
  }).catch(() => { });

  logger.info("[FunnelWebhook:Discovery] endDiscoveryCall", {
    establishmentId,
    outcome,
  });
  return { success: true, outcome };
}

// ============================================================
// ACTIVATION
// ============================================================

async function saveActivationData({
  conversationId,
  establishmentId,
  painPointsConfirmed,
  featuresOfInterest,
  urgencyLevel,
  notes,
}) {
  if (!establishmentId) throw new Error("establishment_id requerido");

  await upsertEnrichmentSnapshot(establishmentId, "activation", {
    conversationId,
    painPointsConfirmed,
    featuresOfInterest,
    urgencyLevel,
    notes,
  });

  logger.info("[FunnelWebhook:Activation] saveActivationData", {
    establishmentId,
    urgencyLevel,
  });
  return { success: true };
}

async function confirmOrUpdateEmail({
  conversationId,
  establishmentId,
  email,
}) {
  if (!establishmentId || !email) throw new Error("establishment_id y email requeridos");

  await prisma.establishmentEnrichment.upsert({
    where: { establishmentId },
    create: { establishmentId, decisionMakerEmail: email },
    update: { decisionMakerEmail: email },
  });

  logger.info("[FunnelWebhook:Activation] confirmOrUpdateEmail", {
    establishmentId,
    email,
  });
  return { success: true };
}

async function scheduleDemo({
  conversationId,
  establishmentId,
  contactName,
  email,
  startTime,
  featuresOfInterest,
}) {
  if (!establishmentId || !startTime || !email)
    throw new Error("establishment_id, email y start_time requeridos");

  // Ensure email is saved before Calendly call
  await prisma.establishmentEnrichment.upsert({
    where: { establishmentId },
    create: {
      establishmentId,
      decisionMakerEmail: email,
      decisionMakerName: contactName || null,
    },
    update: {
      decisionMakerEmail: email,
      ...(contactName ? { decisionMakerName: contactName } : {}),
    },
  });

  const result = await _createCalendlyInvitee({
    establishmentId,
    contactName,
    email,
    startTime,
  });

  // Save activation snapshot
  await upsertEnrichmentSnapshot(establishmentId, "activation", {
    conversationId,
    demoScheduled: true,
    demoDate: startTime,
    featuresOfInterest,
    calendlyResult: result.success ? "scheduled" : "failed",
  });

  logEnrichmentEvent({
    establishmentId,
    source: "CAMPAIGN",
    conversationId,
    agentStage: "ACTIVATION",
    levelReached: "PROSPECT",
    enrichmentSnapshot: { demoDate: startTime, featuresOfInterest },
    enrichedByType: "AGENT",
    notes: "Demo agendada desde Activation Agent",
  }).catch(() => { });

  logger.info("[FunnelWebhook:Activation] scheduleDemo", {
    establishmentId,
    startTime,
    success: result.success,
  });
  return result;
}

async function endActivationCall({
  conversationId,
  establishmentId,
  outcome,
  demoDate,
  callSummary,
}) {
  if (!establishmentId) throw new Error("establishment_id requerido");

  await prisma.establishmentEnrichment.upsert({
    where: { establishmentId },
    create: {
      establishmentId,
      callStatus: toCallStatus(outcome),
      callSummary,
      enrichmentStatus: "activation_completed",
    },
    update: {
      callStatus: toCallStatus(outcome),
      callSummary,
      enrichmentStatus: "activation_completed",
    },
  });

  logEnrichmentEvent({
    establishmentId,
    source: "CAMPAIGN",
    conversationId,
    agentStage: "ACTIVATION",
    levelReached: outcome === "DEMO_SCHEDULED" ? "PROSPECT" : "CONTACT",
    enrichmentSnapshot: { outcome, demoDate, callSummary },
    enrichedByType: "AGENT",
    notes: `Activation outcome: ${outcome}`,
  }).catch(() => { });

  logger.info("[FunnelWebhook:Activation] endActivationCall", {
    establishmentId,
    outcome,
  });
  return { success: true, outcome };
}

// ============================================================
// QUALIFICATION
// ============================================================

async function saveQualificationResult({
  conversationId,
  establishmentId,
  needScore,
  authorityScore,
  budgetScore,
  timelineScore,
  fear,
  pain,
  desire,
  intent,
  qualificationNotes,
}) {
  if (!establishmentId) throw new Error("establishment_id requerido");

  const update = {};
  if (needScore !== undefined && needScore !== -1) update.need_score = needScore;
  if (authorityScore !== undefined && authorityScore !== -1) update.authority_score = authorityScore;
  if (budgetScore !== undefined && budgetScore !== -1) update.budget_score = budgetScore;
  if (timelineScore !== undefined && timelineScore !== -1) update.timeline_score = timelineScore;
  if (fear) update.fear = fear;
  if (pain) update.pain = pain;
  if (desire) update.desire = desire;
  if (intent) update.intent = intent;
  if (qualificationNotes) update.qualification_notes = qualificationNotes;

  // Calculate overall_score if all 4 BANT areas are scored
  const scores = [needScore, authorityScore, budgetScore, timelineScore].filter(
    (s) => s !== undefined && s !== -1
  );
  if (scores.length === 4) {
    update.overall_score = Math.round(scores.reduce((a, b) => a + b, 0) / 4);
    update.qualification_completed = true;
  }

  await prisma.establishmentEnrichment.upsert({
    where: { establishmentId },
    create: { establishmentId, ...update },
    update,
  });

  logger.info("[FunnelWebhook:Qualification] saveQualificationResult", {
    establishmentId,
    needScore,
    authorityScore,
    budgetScore,
    timelineScore,
  });
  return { success: true };
}

async function sendCouponWhatsapp({
  conversationId,
  phone,
  coupon,
  establishmentId,
  campaignId,
  campaignContactId,
  couponType,
  scenario,
  prospectName,
  businessName,
}) {
  let resolvedCampaignId = campaignId;
  let resolvedContactId = campaignContactId;
  let resolvedCouponType = couponType;
  let resolvedProspectName = prospectName;
  let resolvedBusinessName = businessName;
  let resolvedPhone = phone;

  // 1. Fallback por conversationId (la forma más segura de encontrar el contacto original)
  if ((!resolvedCampaignId || !resolvedContactId) && conversationId) {
    const contactByConv = await prisma.campaignContact.findFirst({
      where: { conversationId },
      include: {
        campaign: { select: { id: true, couponPrefix: true } },
      },
    });
    
    if (contactByConv) {
      if (!resolvedCampaignId) resolvedCampaignId = contactByConv.campaignId;
      if (!resolvedContactId) resolvedContactId = contactByConv.id;
      if (!resolvedCouponType && contactByConv.campaign?.couponPrefix) {
        resolvedCouponType = contactByConv.campaign.couponPrefix;
      }
      if (!resolvedPhone) {
        resolvedPhone = contactByConv.establishmentPhone || contactByConv.establishmentData?.phone || contactByConv.establishmentData?.whatsapp || null;
      }
      establishmentId = establishmentId || contactByConv.establishmentId;
    }
  }

  // 2. Si no viene campaignId ni se encontró por conversationId, intentar por establishmentId
  if (!resolvedCampaignId && establishmentId) {
    const activeContact = await prisma.campaignContact.findFirst({
      where: {
        establishmentId,
        campaign: { status: "ACTIVE" },
      },
      include: {
        campaign: {
          select: { id: true, couponPrefix: true, couponTemplateIds: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    if (activeContact) {
      resolvedCampaignId = activeContact.campaignId;
      resolvedContactId = activeContact.id;
      if (!resolvedCouponType && activeContact.campaign?.couponPrefix) {
        resolvedCouponType = activeContact.campaign.couponPrefix;
      }

      // Obtener el teléfono de la BD si el agente no lo envió
      if (!resolvedPhone) {
        resolvedPhone =
          activeContact.establishmentPhone ||
          (activeContact.establishmentData && activeContact.establishmentData.phone) ||
          (activeContact.establishmentData && activeContact.establishmentData.whatsapp) ||
          null;
      }
    }
  }

  // Fallback a Establishment info si todavía no hay teléfono o nombres
  if (!resolvedPhone || !resolvedProspectName || !resolvedBusinessName) {
    if (establishmentId) {
      const enrichment = await prisma.establishmentEnrichment.findUnique({
        where: { establishmentId },
        select: {
          decisionMakerName: true,
          establishment: { select: { phone: true, name: true } },
        },
      });
      if (!resolvedProspectName) resolvedProspectName = enrichment?.decisionMakerName || "Cliente";
      if (!resolvedBusinessName && enrichment?.establishment?.name) resolvedBusinessName = enrichment.establishment.name;
      if (!resolvedPhone && enrichment?.establishment?.phone) resolvedPhone = enrichment.establishment.phone;
    }
  }

  if (!resolvedPhone) throw new Error("phone no pudo ser resuelto (ni por el agente ni en la BD)");

  // Fallback de couponType
  if (!resolvedCouponType && !scenario) {
    resolvedCouponType = "PLUS30"; // Tipo por defecto si no se puede resolver
  }

  // Obtener nombre si no viene
  if (!resolvedProspectName && establishmentId) {
    const enrichment = await prisma.establishmentEnrichment.findUnique({
      where: { establishmentId },
      select: { decisionMakerName: true },
    });
    resolvedProspectName = enrichment?.decisionMakerName || "Cliente";
  }

  // Generar cupón real
  const couponWhatsappService = require("./couponWhatsappService");

  try {
    const result = await couponWhatsappService.generateAndSendCoupon({
      phone: resolvedPhone,
      prospectName: resolvedProspectName || "Cliente",
      businessName: resolvedBusinessName || "Tu negocio",
      scenario: scenario || "qualification_offer",
      agentId: "mcp-qualification-agent",
      callId: conversationId || "unknown",
      campaignId: resolvedCampaignId,
      campaignContactId: resolvedContactId,
      couponType: resolvedCouponType,
    });

    logger.info("[FunnelWebhook:Qualification] sendCouponWhatsapp - cupón real generado", {
      phone: resolvedPhone,
      couponId: result.coupon?.id,
      couponCode: result.coupon?.code,
      couponType: resolvedCouponType,
      campaignId: resolvedCampaignId,
      success: result.success,
    });

    return {
      success: result.success,
      couponCode: result.coupon?.code,
      couponId: result.coupon?.id,
      messageId: result.messageId,
    };
  } catch (err) {
    logger.error("[FunnelWebhook:Qualification] Error generando cupón real", {
      error: err.message,
      phone: resolvedPhone,
      couponType: resolvedCouponType,
    });

    // Fallback: mensaje genérico para no dejar al agente colgado
    const fallbackMessage =
      `¡Gracias por tu interés en EasyOrder!\n\n` +
      `Nuestro equipo te contactará pronto con una oferta especial.\n\n` +
      `Visítanos en el siguiente enlace:\n` +
      `👉 https://easyorder.mx/`;

    await whatsappService.sendWhatsAppMessage({ to: resolvedPhone, message: fallbackMessage }).catch(e => {
      logger.error("[FunnelWebhook:Qualification] Error enviando fallback WhatsApp", {
        error: e.message,
        phone: resolvedPhone
      });
    });

    return { success: false, error: err.message, fallbackSent: true };
  }
}

async function getCalendlyAvailability({ daysAhead = 7 } = {}) {
  if (!CALENDLY_TOKEN) {
    logger.warn("[FunnelWebhook] CALENDLY_API_TOKEN no configurado — devolviendo slots mock");
    return _getMockSlots(daysAhead);
  }

  try {
    const startTime = new Date().toISOString();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + daysAhead);
    const endTime = endDate.toISOString();

    const url = new URL("https://api.calendly.com/event_type_available_times");
    url.searchParams.set("event_type", CALENDLY_EVENT_TYPE_URI);
    url.searchParams.set("start_time", startTime);
    url.searchParams.set("end_time", endTime);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${CALENDLY_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const err = await response.text();
      logger.error("[FunnelWebhook] Calendly availability error", { status: response.status, err });
      return _getMockSlots(daysAhead);
    }

    const data = await response.json();
    const slots = (data.collection || []).slice(0, 6).map((s) => ({
      start_time: s.start_time,
      status: s.status,
      invitees_remaining: s.invitees_remaining,
    }));

    logger.info("[FunnelWebhook:Qualification] getCalendlyAvailability", {
      slotsFound: slots.length,
    });
    return { success: true, slots };
  } catch (error) {
    logger.error("[FunnelWebhook] Error consultando Calendly availability", {
      error: error.message,
    });
    return _getMockSlots(daysAhead);
  }
}

function _getMockSlots(daysAhead) {
  const slots = [];
  const now = new Date();
  for (let d = 1; d <= Math.min(daysAhead, 3); d++) {
    const date = new Date(now);
    date.setDate(date.getDate() + d);
    date.setHours(10, 0, 0, 0);
    slots.push({ start_time: date.toISOString(), status: "available" });
    date.setHours(15, 0, 0, 0);
    slots.push({ start_time: date.toISOString(), status: "available" });
  }
  return { success: true, slots, mock: true };
}

async function scheduleCalendlyDemo({
  conversationId,
  establishmentId,
  contactName,
  email,
  startTime,
  bantScores,
  fpdi,
}) {
  if (!establishmentId || !startTime || !email)
    throw new Error("establishment_id, email y start_time requeridos");

  // Ensure contact data is saved
  await prisma.establishmentEnrichment.upsert({
    where: { establishmentId },
    create: {
      establishmentId,
      decisionMakerEmail: email,
      decisionMakerName: contactName || null,
    },
    update: {
      decisionMakerEmail: email,
      ...(contactName ? { decisionMakerName: contactName } : {}),
    },
  });

  const result = await _createCalendlyInvitee({
    establishmentId,
    contactName,
    email,
    startTime,
  });

  // Save BANT + FPDI in qualification snapshot
  if (bantScores || fpdi) {
    await upsertEnrichmentSnapshot(establishmentId, "qualification", {
      conversationId,
      demoScheduled: true,
      demoDate: startTime,
      bantScores,
      fpdi,
    });
  }

  logEnrichmentEvent({
    establishmentId,
    source: "CAMPAIGN",
    conversationId,
    agentStage: "QUALIFICATION",
    levelReached: "LEAD",
    enrichmentSnapshot: { demoDate: startTime, bantScores, fpdi },
    enrichedByType: "AGENT",
    notes: "Demo agendada desde Qualification Agent",
  }).catch(() => { });

  logger.info("[FunnelWebhook:Qualification] scheduleCalendlyDemo", {
    establishmentId,
    startTime,
    success: result.success,
  });
  return result;
}

async function handleNegativeResponse({
  conversationId,
  establishmentId,
  reason,
  followUpDate,
}) {
  if (!establishmentId) throw new Error("establishment_id requerido");

  await upsertEnrichmentSnapshot(establishmentId, "qualification", {
    conversationId,
    negativeReason: reason,
    followUpDate,
    demoDeclined: true,
  });

  logger.info("[FunnelWebhook:Qualification] handleNegativeResponse", {
    establishmentId,
    reason,
  });
  return { success: true };
}

async function endAndClose({
  conversationId,
  establishmentId,
  outcome,
  qualificationScore,
  couponSent,
  callSummary,
}) {
  if (!establishmentId) throw new Error("establishment_id requerido");

  await prisma.establishmentEnrichment.upsert({
    where: { establishmentId },
    create: {
      establishmentId,
      callStatus: toCallStatus(outcome),
      callSummary,
      enrichmentStatus: "qualification_completed",
      qualification_completed: true,
      qualification_notes: callSummary,
    },
    update: {
      callStatus: toCallStatus(outcome),
      callSummary,
      enrichmentStatus: "qualification_completed",
      qualification_completed: true,
      ...(callSummary ? { qualification_notes: callSummary } : {}),
    },
  });

  const levelMap = { A: "LEAD", B: "LEAD", C: "PROSPECT", D: "CONTACT" };

  logEnrichmentEvent({
    establishmentId,
    source: "CAMPAIGN",
    conversationId,
    agentStage: "QUALIFICATION",
    levelReached: levelMap[qualificationScore] || "PROSPECT",
    enrichmentSnapshot: { outcome, qualificationScore, couponSent, callSummary },
    enrichedByType: "AGENT",
    notes: `Qualification outcome: ${outcome}, Score: ${qualificationScore}`,
  }).catch(() => { });

  logger.info("[FunnelWebhook:Qualification] endAndClose", {
    establishmentId,
    outcome,
    qualificationScore,
  });
  return { success: true, outcome };
}

async function endCall({ conversationId, establishmentId } = {}) {
  logger.info("[FunnelWebhook] endCall ack", { establishmentId, conversationId });
  return { success: true };
}

// ============================================================
// CONVERSION
// ============================================================

async function calculateROI({
  conversationId,
  establishmentId,
  currentMonthlyOrders,
  averageTicket,
  plan,
}) {
  if (!currentMonthlyOrders || !averageTicket || !plan)
    throw new Error("current_monthly_orders, average_ticket y plan requeridos");

  const planCost = PLAN_PRICES[plan?.toUpperCase()] || PLAN_PRICES.PROFESSIONAL;
  const growthRate = 0.30; // 30% promedio EasyOrder
  const additionalOrders = Math.round(currentMonthlyOrders * growthRate);
  const additionalRevenue = additionalOrders * averageTicket;
  const roiMultiple = parseFloat((additionalRevenue / planCost).toFixed(2));
  const breakEvenDays = Math.round(planCost / (additionalRevenue / 30));

  const roi = {
    planCost,
    currentMonthlyOrders,
    averageTicket,
    additionalOrders,
    additionalRevenue,
    roiMultiple,
    breakEvenDays,
    summary: `Con ${additionalOrders} pedidos extra al mes (${(growthRate * 100).toFixed(0)}% de crecimiento), generas $${additionalRevenue.toLocaleString("es-MX")} MXN adicionales. El plan cuesta $${planCost.toLocaleString("es-MX")} MXN. Tu ROI es ${roiMultiple}x en el primer mes.`,
  };

  // Save ROI calculation to enrichment snapshot
  if (establishmentId) {
    await upsertEnrichmentSnapshot(establishmentId, "conversion", {
      conversationId,
      roiCalculation: roi,
    }).catch(() => { });
  }

  logger.info("[FunnelWebhook:Conversion] calculateROI", {
    establishmentId,
    plan,
    roiMultiple,
  });
  return { success: true, roi };
}

async function saveDealTerms({
  conversationId,
  establishmentId,
  planSelected,
  monthlyPrice,
  contractDuration,
  discountPercent,
  startDate,
  paymentMethod,
  notes,
}) {
  if (!establishmentId) throw new Error("establishment_id requerido");

  const dealData = {
    conversationId,
    planSelected,
    monthlyPrice,
    contractDuration,
    discountPercent: discountPercent || 0,
    startDate,
    paymentMethod,
    notes,
    savedAt: new Date().toISOString(),
  };

  await upsertEnrichmentSnapshot(establishmentId, "conversion", dealData);

  // Also store in productPurchased for quick reference
  await prisma.establishmentEnrichment.update({
    where: { establishmentId },
    data: {
      productPurchased: planSelected,
      ...(monthlyPrice ? { purchaseAmount: monthlyPrice } : {}),
      ...(startDate ? { purchaseDate: new Date(startDate) } : {}),
    },
  }).catch(() => { });

  logger.info("[FunnelWebhook:Conversion] saveDealTerms", {
    establishmentId,
    planSelected,
    monthlyPrice,
  });
  return { success: true };
}

async function scheduleOnboarding({
  conversationId,
  establishmentId,
  contactName,
  email,
  onboardingDate,
  planSelected,
  specialRequirements,
}) {
  if (!establishmentId || !onboardingDate)
    throw new Error("establishment_id y onboarding_date requeridos");

  // Ensure email is up to date
  if (email) {
    await prisma.establishmentEnrichment.upsert({
      where: { establishmentId },
      create: {
        establishmentId,
        decisionMakerEmail: email,
        ...(contactName ? { decisionMakerName: contactName } : {}),
      },
      update: {
        decisionMakerEmail: email,
        ...(contactName ? { decisionMakerName: contactName } : {}),
      },
    });
  }

  // Create a Calendly invitee for onboarding if token available
  let calendlyResult = { success: false, note: "No Calendly token" };
  if (CALENDLY_TOKEN && email) {
    calendlyResult = await _createCalendlyInvitee({
      establishmentId,
      contactName,
      email,
      startTime: onboardingDate,
    });
  }

  await upsertEnrichmentSnapshot(establishmentId, "conversion", {
    conversationId,
    onboardingScheduled: true,
    onboardingDate,
    planSelected,
    specialRequirements,
    calendlyResult: calendlyResult.success ? "scheduled" : "pending",
  });

  logEnrichmentEvent({
    establishmentId,
    source: "CAMPAIGN",
    conversationId,
    agentStage: "CONVERSION",
    levelReached: "CLIENT",
    enrichmentSnapshot: { onboardingDate, planSelected, specialRequirements },
    enrichedByType: "AGENT",
    notes: "Onboarding agendado desde Conversion Agent",
  }).catch(() => { });

  logger.info("[FunnelWebhook:Conversion] scheduleOnboarding", {
    establishmentId,
    onboardingDate,
  });
  return { success: true, calendlyResult };
}

async function endConversionCall({
  conversationId,
  establishmentId,
  outcome,
  planClosed,
  monthlyRevenue,
  callSummary,
}) {
  if (!establishmentId) throw new Error("establishment_id requerido");

  const isWon = outcome === "CLOSED_WON";

  await prisma.establishmentEnrichment.upsert({
    where: { establishmentId },
    create: {
      establishmentId,
      callStatus: toCallStatus(outcome),
      callSummary,
      enrichmentStatus: "conversion_completed",
      ...(isWon ? { clientStatus: "active", clientSince: new Date() } : {}),
    },
    update: {
      callStatus: toCallStatus(outcome),
      callSummary,
      enrichmentStatus: "conversion_completed",
      ...(isWon ? { clientStatus: "active", clientSince: new Date() } : {}),
    },
  });

  logEnrichmentEvent({
    establishmentId,
    source: "CAMPAIGN",
    conversationId,
    agentStage: "CONVERSION",
    levelReached: isWon ? "CLIENT" : "LEAD",
    enrichmentSnapshot: { outcome, planClosed, monthlyRevenue, callSummary },
    enrichedByType: "AGENT",
    notes: `Conversion outcome: ${outcome}${planClosed ? `, plan: ${planClosed}` : ""}`,
  }).catch(() => { });

  logger.info("[FunnelWebhook:Conversion] endConversionCall", {
    establishmentId,
    outcome,
    planClosed,
  });
  return { success: true, outcome };
}

// ============================================================
// CALENDLY HELPER
// ============================================================

async function _createCalendlyInvitee({ establishmentId, contactName, email, startTime }) {
  if (!CALENDLY_TOKEN) {
    return { success: false, note: "CALENDLY_API_TOKEN no configurado" };
  }

  try {
    const startDate = new Date(startTime);
    const endDate = new Date(startDate.getTime() + 30 * 60 * 1000); // 30 min

    const payload = {
      event_type: CALENDLY_EVENT_TYPE_URI,
      start_time: startDate.toISOString(),
      end_time: endDate.toISOString(),
      invitee: {
        name: contactName || "Cliente EasyOrder",
        email,
        timezone: "America/Mexico_City",
      },
      questions_and_responses: [
        {
          question_uuid: "establishment_id",
          response: establishmentId,
        },
      ],
    };

    const response = await fetch("https://api.calendly.com/invitees", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CALENDLY_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      logger.error("[FunnelWebhook] Calendly invitee creation failed", {
        status: response.status,
        data,
      });
      return { success: false, error: data };
    }

    logger.info("[FunnelWebhook] Calendly invitee created", {
      email,
      startTime,
    });
    return {
      success: true,
      calendlyUri: data.resource?.uri,
      eventUri: data.resource?.scheduled_event,
    };
  } catch (error) {
    logger.error("[FunnelWebhook] Error creating Calendly invitee", {
      error: error.message,
    });
    return { success: false, error: error.message };
  }
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  // Discovery
  saveDiscoveryData,
  endDiscoveryCall,
  sendWhatsappInfo,
  // Activation
  saveActivationData,
  confirmOrUpdateEmail,
  scheduleDemo,
  endActivationCall,
  // Qualification
  saveQualificationResult,
  sendCouponWhatsapp,
  getCalendlyAvailability,
  scheduleCalendlyDemo,
  handleNegativeResponse,
  endAndClose,
  endCall,
  // Conversion
  calculateROI,
  saveDealTerms,
  scheduleOnboarding,
  endConversionCall,
};
