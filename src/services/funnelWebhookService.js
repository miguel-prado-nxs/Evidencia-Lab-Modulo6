/**
 * Funnel Webhook Service
 *
 * Lógica de negocio para los webhooks del funnel de agentes ElevenLabs.
 * Cubre Discovery, Activation, Qualification y Conversion.
 */

const prisma = require("../config/database");
const prismaGeo = require("../config/database-geo");
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

// Truncar callSummary a 1000 caracteres para evitar errores de longitud en BD
function truncateCallSummary(summary, maxLength = 1000) {
  if (!summary) return null;
  return summary.length > maxLength ? summary.substring(0, maxLength) : summary;
}

// Valida email: rechaza placeholders sin resolver ({{...}}) y strings obviamente
// invalidos. Evita guardar basura como "{{previousEmail}}" en BD.
function isValidEmail(value) {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.includes("{{") || trimmed.includes("}}")) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

// Guardar el outcome original en callStatus
// El check constraint en BD ahora permite todos los outcomes posibles
function getCallStatus(outcome) {
  // Retornar el outcome original directamente (sin truncamiento)
  // Campo expandido a 50 caracteres para acomodar "ADVANCE_TO_ACTIVATION"
  return outcome || null;
}

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
// HELPER: Sincronizar CampaignContact al cerrar llamada
// ============================================================

/**
 * Busca el CampaignContact asociado al establishment en una campaña activa
 * y actualiza su status basándose en el outcome del agente.
 *
 * Mapeo de outcomes a CampaignContact.status:
 * - ADVANCE_TO_ACTIVATION, DEMO_SCHEDULED, CLOSED_WON → RESPONDED
 * - FOLLOW_UP_LATER, FOLLOW_UP, FOLLOW_UP_NEEDED → RESPONDED
 * - NOT_INTERESTED, DISQUALIFIED, LOST, WRONG_NUMBER → FAILED
 * - NO_ANSWER, VOICEMAIL → FAILED
 * - DEMO_DECLINED, OBJECTION_UNRESOLVED → RESPONDED
 *
 * Si se envió cupón (couponSent=true), status → CONVERTED (o se deja RESPONDED
 * y se espera a que el cupón sea redimido para marcar CONVERTED).
 */
async function syncCampaignContactStatus({
  establishmentId,
  conversationId,
  outcome,
  agentStage,
  couponSent = false,
  callSummary,
}) {
  if (!establishmentId) return null;

  try {
    // Buscar el CampaignContact en status CALLING para este establishment
    const contact = await prisma.campaignContact.findFirst({
      where: {
        establishmentId,
        status: "CALLING",
        campaign: { status: "ACTIVE" },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!contact) {
      logger.debug("[syncCampaignContact] No active CampaignContact found for establishment", {
        establishmentId,
        agentStage,
      });
      return null;
    }

    // Determinar el nuevo status
    const positiveOutcomes = [
      "ADVANCE_TO_ACTIVATION",
      "DEMO_SCHEDULED",
      "CLOSED_WON",
      "FOLLOW_UP_LATER",
      "FOLLOW_UP",
      "FOLLOW_UP_NEEDED",
      "DEMO_DECLINED",
      "OBJECTION_UNRESOLVED",
    ];

    const failedOutcomes = [
      "NOT_INTERESTED",
      "DISQUALIFIED",
      "LOST",
      "WRONG_NUMBER",
      "NO_ANSWER",
      "VOICEMAIL",
      "FAILED",
    ];

    let newStatus;
    if (outcome === "CLOSED_WON") {
      newStatus = "CONVERTED";
    } else if (couponSent) {
      newStatus = "RESPONDED"; // Se envió cupón → al menos respondió
    } else if (positiveOutcomes.includes(outcome?.toUpperCase())) {
      newStatus = "RESPONDED";
    } else if (failedOutcomes.includes(outcome?.toUpperCase())) {
      newStatus = "FAILED";
    } else {
      newStatus = "RESPONDED"; // Default conservador
    }

    // Actualizar CampaignContact
    const updated = await prisma.campaignContact.update({
      where: { id: contact.id },
      data: {
        status: newStatus,
        callTranscript: callSummary || null,
        webhookReceivedAt: new Date(),
        establishmentData: {
          ...(contact.establishmentData || {}),
          agentStage,
          outcome,
          conversationId,
          couponSent,
          syncedAt: new Date().toISOString(),
        },
      },
    });

    logger.info("[syncCampaignContact] CampaignContact status updated", {
      contactId: contact.id,
      campaignId: contact.campaignId,
      establishmentId,
      previousStatus: "CALLING",
      newStatus,
      outcome,
      agentStage,
    });

    // Recalcular métricas de la campaña (non-blocking)
    _recalculateCampaignMetrics(contact.campaignId).catch(() => { });

    return { contactId: contact.id, campaignId: contact.campaignId, newStatus };
  } catch (err) {
    logger.error("[syncCampaignContact] Error syncing contact status", {
      error: err.message,
      establishmentId,
      outcome,
    });
    return null;
  }
}

/**
 * Recalcula métricas agregadas de una campaña.
 */
async function _recalculateCampaignMetrics(campaignId) {
  if (!campaignId) return;

  try {
    const contacts = await prisma.campaignContact.findMany({
      where: { campaignId },
      select: { status: true, couponId: true, establishmentData: true },
    });

    const statusCount = {};
    let couponsSent = 0;

    for (const c of contacts) {
      statusCount[c.status] = (statusCount[c.status] || 0) + 1;

      // Contar cupones si el contacto tiene `couponId` O su metadata de establishment indica que se envió cupón
      if (c.couponId || (c.establishmentData && typeof c.establishmentData === 'object' && c.establishmentData.couponSent)) {
        couponsSent++;
      }
    }

    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        totalContacts: contacts.length,
        totalCalled: (statusCount.CALLING || 0) + (statusCount.RESPONDED || 0) + (statusCount.CONVERTED || 0) + (statusCount.FAILED || 0),
        totalResponded: statusCount.RESPONDED || 0,
        totalConverted: statusCount.CONVERTED || 0,
        totalFailed: statusCount.FAILED || 0,
        couponsSent,
      },
    });

    logger.debug("[_recalculateCampaignMetrics] Metrics updated", { campaignId, statusCount });
  } catch (err) {
    logger.error("[_recalculateCampaignMetrics] Error", { error: err.message, campaignId });
  }
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
  contactEmail,
  businessType,
  painPoint,
  interestLevel,
  notes,
  restaurantName,
  restaurantAge,
  branchCount,
  salesChannel,
  orderMethod,
  closingMethod,
  mainDifficulty,
  frequentErrors,
  timeLost,
  closingClarity,
  previousSystems,
  improvementInterest,
  problemPriority,
  dailyOrders,
}) {
  if (!establishmentId) throw new Error("establishment_id requerido");

  // 1. Persistir decisionMakerName y decisionMakerEmail si vienen
  //    Son columnas planas que consultan los siguientes agentes
  const columnUpdate = {};
  if (contactName) columnUpdate.decisionMakerName = contactName;
  if (contactEmail && isValidEmail(contactEmail)) {
    columnUpdate.decisionMakerEmail = contactEmail;
  }

  if (Object.keys(columnUpdate).length > 0) {
    await prisma.establishmentEnrichment.upsert({
      where: { establishmentId },
      create: { establishmentId, ...columnUpdate },
      update: columnUpdate,
    });
  }

  // 2. Snapshot JSON con todos los campos PLG capturados por el agente.
  //    Solo se incluyen claves con valor para no sobreescribir con undefined.
  const snapshot = {
    conversationId,
    contactName,
    contactEmail,
    businessType,
    painPoint,
    interestLevel,
    notes,
    restaurantName,
    restaurantAge,
    branchCount,
    salesChannel,
    orderMethod,
    closingMethod,
    mainDifficulty,
    frequentErrors,
    timeLost,
    closingClarity,
    previousSystems,
    improvementInterest,
    problemPriority,
    dailyOrders,
  };
  const cleanSnapshot = Object.fromEntries(
    Object.entries(snapshot).filter(([, v]) => v !== undefined && v !== null && v !== "")
  );
  if (Object.keys(cleanSnapshot).length > 0) {
    await upsertEnrichmentSnapshot(establishmentId, "discovery", cleanSnapshot);
  }

  logger.info("[FunnelWebhook:Discovery] saveDiscoveryData", {
    establishmentId,
    contactName,
    interestLevel,
    fieldsCount: Object.keys(cleanSnapshot).length,
  });
  return { success: true };
}

async function endDiscoveryCall({
  conversationId,
  establishmentId,
  outcome,
  originalOutcome,
  contactName,
  contactEmail,
  businessType,
  painPoint,
  interestLevel,
  callSummary,
  callDuration,
}) {
  if (!establishmentId) throw new Error("establishment_id requerido");

  // Outcomes conversacionales que marcan discovery_completed.
  // Usar originalOutcome (antes del mapeo INTERESTED->ADVANCE_TO_ACTIVATION).
  const CONVERSATIONAL_OUTCOMES = [
    "INTERESTED",
    "ADVANCE_TO_ACTIVATION",
    "FOLLOW_UP_LATER",
    "NOT_INTERESTED",
  ];
  const effectiveOutcome = (originalOutcome || outcome || "").toUpperCase();
  const isConversational = CONVERSATIONAL_OUTCOMES.includes(effectiveOutcome);

  // 1. Guardar datos finales (incluye decisionMakerName y email en columna plana)
  await saveDiscoveryData({
    conversationId,
    establishmentId,
    contactName,
    contactEmail,
    businessType,
    painPoint,
    interestLevel,
    notes: callSummary,
  });

  // 2. Actualizar callStatus (SIEMPRE) y enrichmentStatus (SOLO si conversacional)
  const updateData = {
    callSummary: truncateCallSummary(callSummary),
    callStatus: getCallStatus(effectiveOutcome),
    gatekeeperInfo: conversationId ? { conversationId } : null,
    callDurationSeconds: callDuration || 0,
  };
  // Reforzar decisionMakerName y email aqui tambien por si saveDiscoveryData no los
  // recibio (ej. agente solo llamo end_discovery_call).
  if (contactName) updateData.decisionMakerName = contactName;
  if (contactEmail && isValidEmail(contactEmail)) {
    updateData.decisionMakerEmail = contactEmail;
  }

  // SOLO actualizar enrichmentStatus si hubo conversación
  if (isConversational) {
    updateData.enrichmentStatus = "discovery_completed";
    updateData.level = "CONTACT";
  }

  await prisma.establishmentEnrichment.upsert({
    where: { establishmentId },
    create: {
      establishmentId,
      ...updateData,
      enrichedBy: "DISCOVERY_AGENT",
      enrichedAt: new Date(),
      lastUpdatedBy: "DISCOVERY_AGENT",
    },
    update: {
      ...updateData,
      lastUpdatedBy: "DISCOVERY_AGENT",
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


  // Sincronizar CampaignContact
  await syncCampaignContactStatus({
    establishmentId,
    conversationId,
    outcome,
    agentStage: "DISCOVERY",
    callSummary,
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
  accountCreated,
  businessRegistered,
  menuLoaded,
  firstOrderRegistered,
  confusionAreas,
  resolveFirst,
  implementationTime,
  soloOrTeam,
  perceivedComplexity,
}) {
  if (!establishmentId) throw new Error("establishment_id requerido");

  const snapshot = {
    conversationId,
    painPointsConfirmed,
    featuresOfInterest,
    urgencyLevel,
    notes,
    accountCreated,
    businessRegistered,
    menuLoaded,
    firstOrderRegistered,
    confusionAreas,
    resolveFirst,
    implementationTime,
    soloOrTeam,
    perceivedComplexity,
  };
  const cleanSnapshot = Object.fromEntries(
    Object.entries(snapshot).filter(([, v]) => v !== undefined && v !== null && v !== "")
  );

  await upsertEnrichmentSnapshot(establishmentId, "activation", cleanSnapshot);

  logger.info("[FunnelWebhook:Activation] saveActivationData", {
    establishmentId,
    urgencyLevel,
    accountCreated,
    fieldsCount: Object.keys(cleanSnapshot).length,
  });
  return { success: true };
}

async function confirmOrUpdateEmail({
  conversationId,
  establishmentId,
  email,
}) {
  if (!establishmentId || !email) throw new Error("establishment_id y email requeridos");

  // Rechazar placeholders no resueltos ({{previousEmail}}) y emails invalidos.
  if (!isValidEmail(email)) {
    logger.warn("[FunnelWebhook:Activation] confirmOrUpdateEmail email invalido, ignorado", {
      establishmentId,
      email,
    });
    return { success: false, error: "invalid_email", email };
  }

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

  if (!isValidEmail(email)) {
    logger.warn("[FunnelWebhook:Activation] scheduleDemo email invalido", {
      establishmentId,
      email,
    });
    return { success: false, error: "invalid_email", email };
  }

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

  // Outcomes conversacionales que marcan activation_completed
  const CONVERSATIONAL_OUTCOMES = [
    "ACTIVATED",
    "DEMO_SCHEDULED",
    "FOLLOW_UP_LATER",
    "NOT_INTERESTED",
    "NO_ANSWER",
    "VOICEMAIL",
  ];
  const effectiveOutcome = (outcome || "").toUpperCase();
  const isConversational = CONVERSATIONAL_OUTCOMES.includes(effectiveOutcome);

  // Actualizar callStatus (SIEMPRE) y enrichmentStatus (SOLO si conversacional)
  const updateData = {
    callStatus: getCallStatus(outcome),
    callSummary: truncateCallSummary(callSummary),
  };

  // SOLO subir enrichmentStatus y level si hubo conversacion util.
  // LEAD solo para los outcomes que realmente avanzan (ACTIVATED/DEMO_SCHEDULED).
  if (isConversational) {
    updateData.enrichmentStatus = "activation_completed";
    if (effectiveOutcome === "ACTIVATED" || effectiveOutcome === "DEMO_SCHEDULED") {
      updateData.level = "LEAD";
    }
  }

  await prisma.establishmentEnrichment.upsert({
    where: { establishmentId },
    create: {
      establishmentId,
      ...updateData,
      enrichedBy: "ACTIVATION_AGENT",
      enrichedAt: new Date(),
      lastUpdatedBy: "ACTIVATION_AGENT",
    },
    update: {
      ...updateData,
      lastUpdatedBy: "ACTIVATION_AGENT",
    },
  });

  // Guardar la snapshot final de activation con outcome y resumen
  await upsertEnrichmentSnapshot(establishmentId, "activation", {
    conversationId,
    outcome,
    demoDate,
    callSummary,
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

  // Sincronizar CampaignContact
  await syncCampaignContactStatus({
    establishmentId,
    conversationId,
    outcome,
    agentStage: "ACTIVATION",
    callSummary,
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

  // Guardar datos de qualification en establishment_data
  if (conversationId || needScore !== undefined || authorityScore !== undefined || budgetScore !== undefined || timelineScore !== undefined) {
    await upsertEnrichmentSnapshot(establishmentId, "qualification", {
      conversationId,
      needScore,
      authorityScore,
      budgetScore,
      timelineScore,
      fear,
      pain,
      desire,
      intent,
      qualificationNotes,
    });
  }

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
        campaign: {
          select: {
            id: true,
            couponPrefix: true,
            couponTemplate: { select: { couponType: true } }
          }
        },
      },
    });

    if (contactByConv) {
      if (!resolvedCampaignId) resolvedCampaignId = contactByConv.campaignId;
      if (!resolvedContactId) resolvedContactId = contactByConv.id;
      if (!resolvedCouponType && contactByConv.campaign?.couponTemplate?.couponType) {
        resolvedCouponType = contactByConv.campaign.couponTemplate.couponType;
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
          select: {
            id: true,
            couponPrefix: true,
            couponTemplateIds: true,
            couponTemplate: { select: { couponType: true } }
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    if (activeContact) {
      resolvedCampaignId = activeContact.campaignId;
      resolvedContactId = activeContact.id;
      if (!resolvedCouponType && activeContact.campaign?.couponTemplate?.couponType) {
        resolvedCouponType = activeContact.campaign.couponTemplate.couponType;
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
        },
      });
      if (!resolvedProspectName) resolvedProspectName = enrichment?.decisionMakerName || "Cliente";

      // Obtener datos del establecimiento desde prismaGeo
      if (!resolvedBusinessName || !resolvedPhone) {
        const establishment = await prismaGeo.establishment.findUnique({
          where: { id: establishmentId },
          select: { phone: true, name: true },
        });
        if (!resolvedBusinessName && establishment?.name) resolvedBusinessName = establishment.name;
        if (!resolvedPhone && establishment?.phone) resolvedPhone = establishment.phone;
      }
    }
  }

  if (!resolvedPhone) throw new Error("phone no pudo ser resuelto (ni por el agente ni en la BD)");

  // Fallback de couponType: si no vino del agente, resolverlo desde la campaña
  if (!resolvedCouponType && resolvedCampaignId) {
    const campaignData = await prisma.campaign.findUnique({
      where: { id: resolvedCampaignId },
      select: {
        couponPrefix: true,
        couponTemplateIds: true,
        couponTemplate: { select: { couponType: true } }
      },
    });

    // Intentar desde couponPrefix (que es FK a template.id)
    if (!resolvedCouponType && campaignData?.couponTemplate?.couponType) {
      resolvedCouponType = campaignData.couponTemplate.couponType;
    }

    // Fallback a couponTemplateIds si couponPrefix no resolvió
    if (!resolvedCouponType && campaignData?.couponTemplateIds?.length > 0) {
      const tpl = await prisma.couponTemplate.findFirst({
        where: { id: { in: campaignData.couponTemplateIds } },
        orderBy: { priority: "desc" },
        select: { couponType: true },
      });
      if (tpl) resolvedCouponType = tpl.couponType;
    }
  }

  // Validar que el couponType resuelto existe como template activo.
  // Si no existe (agente inventó un valor como "descuento"), invalidar para que
  // el fallback de campaña pueda resolverlo correctamente en el siguiente bloque.
  if (resolvedCouponType) {
    const templateExists = await prisma.couponTemplate.findFirst({
      where: { couponType: resolvedCouponType, active: true }
    });
    if (!templateExists) {
      logger.warn("[sendCouponWhatsapp] Invalid couponType from agent, will resolve from campaign", {
        invalidCouponType: resolvedCouponType,
        scenario,
        establishmentId
      });
      resolvedCouponType = null;
    }
  }

  // Fallback de couponType: si el agente no mandó un valor válido, resolverlo desde la campaña.
  // Este bloque corre DESPUÉS de la validación para cubrir el caso donde el agente inventó un valor.
  if (!resolvedCouponType && resolvedCampaignId) {
    const campaignData = await prisma.campaign.findUnique({
      where: { id: resolvedCampaignId },
      select: {
        couponPrefix: true,
        couponTemplateIds: true,
        couponTemplate: { select: { couponType: true } }
      },
    });

    if (campaignData?.couponTemplate?.couponType) {
      resolvedCouponType = campaignData.couponTemplate.couponType;
    } else if (campaignData?.couponTemplateIds?.length > 0) {
      const tpl = await prisma.couponTemplate.findFirst({
        where: { id: { in: campaignData.couponTemplateIds } },
        orderBy: { priority: "desc" },
        select: { couponType: true },
      });
      if (tpl) resolvedCouponType = tpl.couponType;
    }
  }

  if (!resolvedCouponType && !scenario) {
    resolvedCouponType = "PLUS30"; // Tipo por defecto si no se puede resolver de ninguna fuente
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

  if (!isValidEmail(email)) {
    logger.warn("[FunnelWebhook:Qualification] scheduleCalendlyDemo email invalido", {
      establishmentId,
      email,
    });
    return { success: false, error: "invalid_email", email };
  }

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

async function endQualificationCall({
  conversationId,
  establishmentId,
  outcome,
  callSummary,
}) {
  if (!establishmentId) throw new Error("establishment_id requerido");

  // Outcomes conversacionales que marcan qualification_completed
  const CONVERSATIONAL_OUTCOMES = [
    "QUALIFIED",
    "NOT_QUALIFIED",
    "FOLLOW_UP_LATER",
    "NOT_INTERESTED",
    "NO_ANSWER",
    "VOICEMAIL",
  ];
  const effectiveOutcome = (outcome || "").toUpperCase();
  const isConversational = CONVERSATIONAL_OUTCOMES.includes(effectiveOutcome);

  // Actualizar callStatus (SIEMPRE) y enrichmentStatus (SOLO si conversacional)
  const truncatedSummary = truncateCallSummary(callSummary);
  const updateData = {
    callStatus: getCallStatus(outcome),
    callSummary: truncatedSummary,
  };

  // Subir enrichmentStatus a qualification_completed si hubo conversacion
  if (isConversational) {
    updateData.enrichmentStatus = "qualification_completed";
    const advancesToProspect = ["QUALIFIED", "FOLLOW_UP_LATER"];
    if (advancesToProspect.includes(effectiveOutcome)) {
      updateData.level = "PROSPECT";
    }
    updateData.qualification_completed = true;
    if (truncatedSummary) {
      updateData.qualification_notes = truncatedSummary;
    }
  }

  await prisma.establishmentEnrichment.upsert({
    where: { establishmentId },
    create: {
      establishmentId,
      ...updateData,
      enrichedBy: "QUALIFICATION_AGENT",
      enrichedAt: new Date(),
      lastUpdatedBy: "QUALIFICATION_AGENT",
    },
    update: {
      ...updateData,
      lastUpdatedBy: "QUALIFICATION_AGENT",
    },
  });

  // Guardar la snapshot final de qualification con outcome
  await upsertEnrichmentSnapshot(establishmentId, "qualification", {
    conversationId,
    outcome,
    callSummary,
  });

  logEnrichmentEvent({
    establishmentId,
    source: "CAMPAIGN",
    conversationId,
    agentStage: "QUALIFICATION",
    levelReached: ["QUALIFIED", "FOLLOW_UP_LATER"].includes(effectiveOutcome) ? "PROSPECT" : "CONTACT",
    enrichmentSnapshot: { outcome, callSummary },
    enrichedByType: "AGENT",
    notes: `Qualification outcome: ${outcome}`,
  }).catch(() => { });

  logger.info("[FunnelWebhook:Qualification] endQualificationCall", {
    establishmentId,
    outcome,
  });

  await syncCampaignContactStatus({
    establishmentId,
    conversationId,
    outcome,
    agentStage: "QUALIFICATION",
    callSummary,
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

  // Ensure email is up to date (solo si es valido, no placeholder)
  const emailOk = isValidEmail(email);
  if (email && emailOk) {
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
  } else if (email) {
    logger.warn("[FunnelWebhook:Conversion] scheduleOnboarding email invalido, no se persiste", {
      establishmentId,
      email,
    });
  }

  // Create a Calendly invitee for onboarding if token available
  let calendlyResult = { success: false, note: "No Calendly token" };
  if (CALENDLY_TOKEN && emailOk) {
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

// Persistir objecion detectada en conversion (llamada por conversionMcp.save_objection_data)
async function saveObjectionData({
  conversationId,
  establishmentId,
  objectionType,
  objectionDetail,
  objectionResolved,
  resolutionMethod,
}) {
  if (!establishmentId) throw new Error("establishment_id requerido");

  await upsertEnrichmentSnapshot(establishmentId, "conversion", {
    conversationId,
    objectionType,
    objectionDetail,
    objectionResolved,
    resolutionMethod,
  });

  logger.info("[FunnelWebhook:Conversion] saveObjectionData", {
    establishmentId,
    objectionType,
    objectionResolved,
  });
  return { success: true };
}

// Persistir resultado conversacional previo al cierre (llamada por conversionMcp.save_conversation_outcome)
async function saveConversationOutcome({
  conversationId,
  establishmentId,
  decisionStatus,
  decisionTimeline,
  dependsOnOthers,
  conditionsToAdvance,
  perceivedValue,
  couponOffered,
  couponTypeOffered,
}) {
  if (!establishmentId) throw new Error("establishment_id requerido");

  await upsertEnrichmentSnapshot(establishmentId, "conversion", {
    conversationId,
    decisionStatus,
    decisionTimeline,
    dependsOnOthers,
    conditionsToAdvance,
    perceivedValue,
    couponOffered,
    couponTypeOffered,
  });

  logger.info("[FunnelWebhook:Conversion] saveConversationOutcome", {
    establishmentId,
    decisionStatus,
    perceivedValue,
  });
  return { success: true };
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

  // Outcomes conversacionales que marcan conversion_completed
  const CONVERSATIONAL_OUTCOMES = [
    "CLOSED_WON",
    "FOLLOW_UP_LATER",
    "NEEDS_VALIDATION",
    "NOT_INTERESTED",
    "LOST",
    "NO_ANSWER",
    "VOICEMAIL",
  ];
  const effectiveOutcome = (outcome || "").toUpperCase();
  const isConversational = CONVERSATIONAL_OUTCOMES.includes(effectiveOutcome);
  const isWon = effectiveOutcome === "CLOSED_WON";

  // Actualizar callStatus (SIEMPRE) y enrichmentStatus (SOLO si conversacional)
  const updateData = {
    callStatus: getCallStatus(outcome),
    callSummary: truncateCallSummary(callSummary),
  };

  // SOLO actualizar enrichmentStatus si hubo conversación
  if (isConversational) {
    updateData.enrichmentStatus = "conversion_completed";
    if (isWon) {
      updateData.level = "CLIENT";
      updateData.clientStatus = "active";
      updateData.clientSince = new Date();
    }
  }

  await prisma.establishmentEnrichment.upsert({
    where: { establishmentId },
    create: {
      establishmentId,
      ...updateData,
      enrichedBy: "CONVERSION_AGENT",
      enrichedAt: new Date(),
      lastUpdatedBy: "CONVERSION_AGENT",
    },
    update: {
      ...updateData,
      lastUpdatedBy: "CONVERSION_AGENT",
    },
  });

  // Guardar la snapshot final de conversion con outcome y datos del cierre
  await upsertEnrichmentSnapshot(establishmentId, "conversion", {
    conversationId,
    outcome,
    planClosed,
    monthlyRevenue,
    callSummary,
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

  await syncCampaignContactStatus({
    establishmentId,
    conversationId,
    outcome,
    agentStage: "CONVERSION",
    callSummary,
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

async function markVoicemail({ conversationId, establishmentId, detectionReason, transcriptSnippet, detectedAt }) {
  if (!establishmentId) throw new Error("establishment_id requerido");

  logger.info("[markVoicemail] Voicemail detectado", {
    establishmentId,
    conversationId,
    detectionReason,
    detectedAt,
  });

  return { success: true, message: "Voicemail detectado y registrado" };
}

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
  endQualificationCall,
  // Conversion
  calculateROI,
  saveDealTerms,
  scheduleOnboarding,
  saveObjectionData,
  saveConversationOutcome,
  endConversionCall,
  // Voicemail
  markVoicemail,
  // Helpers de sincronización
  syncCampaignContactStatus,
};
