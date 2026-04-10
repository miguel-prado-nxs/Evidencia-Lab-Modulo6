const prisma = require("../config/database");
const prismaGeo = require("../config/database-geo");
const logger = require("../config/logger");
const axios = require("axios");
const geoService = require("./geoService");
const campaignBatchDispatcherService = require("./campaignBatchDispatcherService");
const campaignContextService = require("./campaignContextService");

const ELEVENLABS_AGENTS_URL = process.env.ELEVENLABS_AGENTS_URL || "https://api.elevenlabs.io/v1/convai/agents";

const extractAgentNameFromAgent = (agent = {}) => {
  return agent.name || agent.agent_name || null;
};

const extractVoiceNameFromAgent = (agent = {}) => {
  return (
    agent.voice_name ||
    agent.voiceName ||
    agent.conversation_config?.tts?.voice_name ||
    agent.conversation_config?.voice?.voice_name ||
    agent.conversation_config?.voice?.name ||
    null
  );
};

const extractVoiceIdFromAgent = (agent = {}) => {
  return (
    agent.voice_id ||
    agent.voiceId ||
    agent.conversation_config?.tts?.voice_id ||
    agent.conversation_config?.voice?.voice_id ||
    agent.conversation_config?.voice?.id ||
    null
  );
};

const fetchAgentProfile = async (agentId) => {
  if (!agentId || !process.env.ELEVENLABS_API_KEY) {
    return {
      agentName: null,
      voiceName: null,
      voiceId: null,
    };
  }

  try {
    const response = await axios.get(ELEVENLABS_AGENTS_URL, {
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
      },
      timeout: 10000,
    });

    const agentsArray = Array.isArray(response.data) ? response.data : response.data.agents || [];
    const selectedAgent = agentsArray.find((agent) => agent.agent_id === agentId || agent.id === agentId);

    if (!selectedAgent) {
      return {
        agentName: null,
        voiceName: null,
        voiceId: null,
      };
    }

    return {
      agentName: extractAgentNameFromAgent(selectedAgent),
      voiceName: extractVoiceNameFromAgent(selectedAgent),
      voiceId: extractVoiceIdFromAgent(selectedAgent),
    };
  } catch (error) {
    logger.warn("Failed to resolve ElevenLabs agent profile", {
      agentId,
      error: error.message,
    });
    return {
      agentName: null,
      voiceName: null,
      voiceId: null,
    };
  }
};

const normalizeScheduledTimeUnix = (scheduledTimeUnix) => {
  // Log for debugging
  console.log('[normalizeScheduledTimeUnix] Input:', scheduledTimeUnix, 'Type:', typeof scheduledTimeUnix);

  if (scheduledTimeUnix === null || scheduledTimeUnix === undefined) {
    console.log('[normalizeScheduledTimeUnix] Input is null/undefined, returning undefined (immediate execution)');
    return undefined;
  }

  let parsed = Number.parseInt(String(scheduledTimeUnix), 10);
  console.log('[normalizeScheduledTimeUnix] Parsed:', parsed);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.log('[normalizeScheduledTimeUnix] Not finite or <= 0, returning undefined');
    return undefined;
  }

  // ElevenLabs expects epoch seconds. Normalize robustly from ms/us/ns if needed.
  while (parsed > 9_999_999_999) {
    console.log('[normalizeScheduledTimeUnix] Dividing by 1000:', parsed);
    parsed = Math.floor(parsed / 1000);
  }

  // If it's in the past or nearly now, treat as immediate call (no scheduling).
  const nowUnix = Math.floor(Date.now() / 1000);
  console.log('[normalizeScheduledTimeUnix] Now:', nowUnix, 'Scheduled:', parsed, 'Diff:', parsed - nowUnix, 'seconds');

  if (parsed <= nowUnix + 30) {
    console.log('[normalizeScheduledTimeUnix] Scheduled time is in the past or within 30 seconds, returning undefined (immediate execution)');
    return undefined;
  }

  console.log('[normalizeScheduledTimeUnix] Valid scheduled time, returning:', parsed);
  return parsed;
};

const createCampaign = async (data) => {
  const {
    name,
    description,
    type,
    centerLat,
    centerLng,
    radiusMeters,
    activityCodes,
    employeeRanges,
    filters,
    agentConfigId,
    agentConfigName,
    offer,
    couponPrefix,
    couponTemplateIds,
    createdBy,
  } = data;

  if (!name) {
    throw new Error("Campaign name is required");
  }

  if (centerLat && centerLng && !radiusMeters) {
    throw new Error("radiusMeters is required when centerLat and centerLng are provided");
  }

  if (radiusMeters && radiusMeters < 0) {
    throw new Error("radiusMeters must be a positive number");
  }

  const campaign = await prisma.campaign.create({
    data: {
      name,
      description,
      type,
      status: "DRAFT",
      centerLat,
      centerLng,
      radiusMeters,
      activityCodes: activityCodes || [],
      employeeRanges: employeeRanges || [],
      filters,
      agentConfigId,
      agentConfigName,
      offer,
      couponPrefix,
      couponTemplateIds: couponTemplateIds || [],
      createdBy,
    },
  });

  if (campaign.centerLat && campaign.centerLng && campaign.radiusMeters) {
    await assignContactsWithGeoFilter(campaign.id, {
      ...(campaign.filters && typeof campaign.filters === "object" ? campaign.filters : {}),
      activityCodes: campaign.activityCodes || [],
      employeeRanges: campaign.employeeRanges || [],
    });
  }

  logger.info(`Campaign created: ${campaign.id}`, { campaignId: campaign.id });
  return campaign;
};

const getCampaignById = async (id) => {
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      contacts: {
        take: 10,
        orderBy: { createdAt: "desc" },
      },
      coupons: {
        take: 10,
        orderBy: { createdAt: "desc" },
      },
      couponTemplate: true,
    },
  });

  if (!campaign) {
    throw new Error("Campaign not found");
  }

  return campaign;
};

const listCampaigns = async (filters = {}) => {
  const { status, createdBy, page = 1, limit = 20 } = filters;

  const where = {};
  if (status) where.status = status;
  if (createdBy) where.createdBy = createdBy;

  const [campaigns, total] = await Promise.all([
    prisma.campaign.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        _count: {
          select: {
            contacts: true,
            coupons: true,
          },
        },
        couponTemplate: true,
      },
    }),
    prisma.campaign.count({ where }),
  ]);

  return {
    campaigns,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const updateCampaign = async (id, data) => {
  const {
    name,
    description,
    type,
    status,
    centerLat,
    centerLng,
    radiusMeters,
    activityCodes,
    employeeRanges,
    filters,
    agentConfigId,
    agentConfigName,
    offer,
    couponPrefix,
    couponTemplateIds
  } = data;

  const existingCampaign = await prisma.campaign.findUnique({
    where: { id },
  });

  if (!existingCampaign) {
    throw new Error("Campaign not found");
  }

  if (existingCampaign.status === "COMPLETED" || existingCampaign.status === "CANCELLED") {
    throw new Error(`Cannot update campaign with status ${existingCampaign.status}`);
  }

  if (existingCampaign.status === "ACTIVE") {
    throw new Error("Cannot update an active campaign");
  }

  if (radiusMeters && radiusMeters < 0) {
    throw new Error("radiusMeters must be a positive number");
  }

  const updateData = {};
  if (name !== undefined) updateData.name = name;
  if (description !== undefined) updateData.description = description;
  if (type !== undefined) updateData.type = type;
  if (status !== undefined) updateData.status = status;
  if (centerLat !== undefined) updateData.centerLat = centerLat;
  if (centerLng !== undefined) updateData.centerLng = centerLng;
  if (radiusMeters !== undefined) updateData.radiusMeters = radiusMeters;
  if (activityCodes !== undefined) updateData.activityCodes = activityCodes;
  if (employeeRanges !== undefined) updateData.employeeRanges = employeeRanges;
  if (filters !== undefined) updateData.filters = filters;
  if (agentConfigId !== undefined) updateData.agentConfigId = agentConfigId;
  if (agentConfigName !== undefined) updateData.agentConfigName = agentConfigName;
  if (offer !== undefined) updateData.offer = offer;
  if (couponPrefix !== undefined) updateData.couponPrefix = couponPrefix;
  if (couponTemplateIds !== undefined) updateData.couponTemplateIds = couponTemplateIds;

  const campaign = await prisma.campaign.update({
    where: { id },
    data: updateData,
  });

  // Eliminar contactos existentes y reasignar nuevos si hay parámetros geográficos
  if (campaign.centerLat && campaign.centerLng && campaign.radiusMeters) {
    // Eliminar todos los contactos existentes de la campaña
    await prisma.campaignContact.deleteMany({
      where: { campaignId: id },
    });

    // Reasignar contactos con los nuevos filtros
    await assignContactsWithGeoFilter(campaign.id, {
      ...(campaign.filters && typeof campaign.filters === "object" ? campaign.filters : {}),
      activityCodes: campaign.activityCodes || [],
      employeeRanges: campaign.employeeRanges || [],
    });

    logger.info(`Campaign contacts refreshed: ${campaign.id}`, { campaignId: campaign.id });
  }

  logger.info(`Campaign updated: ${campaign.id}`, { campaignId: campaign.id });
  return campaign;
};

const deleteCampaign = async (id) => {
  const campaign = await prisma.campaign.findUnique({
    where: { id },
  });

  if (!campaign) {
    throw new Error("Campaign not found");
  }

  if (campaign.status === "ACTIVE") {
    throw new Error("Cannot delete an active campaign. Pause or cancel it first.");
  }

  await prisma.campaign.delete({
    where: { id },
  });

  logger.info(`Campaign deleted: ${id}`, { campaignId: id });
  return { success: true };
};

const assignContactsToCampaign = async (campaignId, establishmentIds) => {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
  });

  if (!campaign) {
    throw new Error("Campaign not found");
  }

  if (!Array.isArray(establishmentIds) || establishmentIds.length === 0) {
    throw new Error("establishmentIds must be a non-empty array");
  }

  const uniqueEstablishmentIds = [...new Set(establishmentIds.filter(Boolean))];
  let establishments = [];

  if (uniqueEstablishmentIds.length > 0) {
    try {
      establishments = await prismaGeo.establishment.findMany({
        where: {
          id: { in: uniqueEstablishmentIds },
        },
        select: {
          id: true,
          name: true,
          businessName: true,
          phone: true,
          email: true,
          website: true,
          activityName: true,
          latitude: true,
          longitude: true,
          municipalityName: true,
          stateName: true,
          employeeRange: true,
          streetName: true,
          exteriorNum: true,
          neighborhood: true,
        },
      });
    } catch (geoError) {
      logger.warn("Geo DB lookup failed while assigning campaign contacts", {
        campaignId,
        error: geoError.message,
      });
    }
  }

  const establishmentById = new Map(establishments.map((establishment) => [establishment.id, establishment]));

  const contacts = await prisma.$transaction(
    establishmentIds.map((establishmentId) => {
      const establishment = establishmentById.get(establishmentId);

      const establishmentNameToUse = establishment?.businessName || establishment?.name || null;

      const establishmentData = establishment
        ? {
          name: establishmentNameToUse,
          phone: establishment.phone || null,
          email: establishment.email || null,
          website: establishment.website || null,
          activityName: establishment.activityName || null,
          latitude: establishment.latitude ?? null,
          longitude: establishment.longitude ?? null,
          municipalityName: establishment.municipalityName || null,
          stateName: establishment.stateName || null,

          employees: establishment.employeeRange ? establishment.employeeRange.trim() : "-",

          address: [
            establishment.streetName,
            establishment.exteriorNum,
            establishment.neighborhood,
            establishment.municipalityName,
            establishment.stateName
          ].filter(Boolean).join(", ")
        }
        : null;


      return prisma.campaignContact.upsert({
        where: {
          campaignId_establishmentId: {
            campaignId,
            establishmentId,
          },
        },
        update: {
          establishmentName: establishmentNameToUse,
          establishmentPhone: establishment?.phone || null,
          establishmentData,
        },
        create: {
          campaignId,
          establishmentId,
          establishmentName: establishmentNameToUse,
          establishmentPhone: establishment?.phone || null,
          establishmentData,
          status: "PENDING",
        },
      });
    }
    )
  );

  const totalContacts = await prisma.campaignContact.count({
    where: { campaignId },
  });

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      totalContacts,
    },
  });

  logger.info(`Assigned ${contacts.length} contacts to campaign ${campaignId}`);
  return contacts;
};

const assignContactsWithGeoFilter = async (campaignId, options = {}) => {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
  });

  if (!campaign) {
    throw new Error("Campaign not found");
  }

  if (!campaign.centerLat || !campaign.centerLng || !campaign.radiusMeters) {
    throw new Error("Campaign must have geographic coordinates and radius defined");
  }

  const mergedFilters = {
    ...(campaign.filters && typeof campaign.filters === "object" ? campaign.filters : {}),
    ...options,
  };

  if (!mergedFilters.activityCode && Array.isArray(campaign.activityCodes) && campaign.activityCodes.length > 0) {
    mergedFilters.activityCode = campaign.activityCodes.join(",");
  }

  const establishments = await geoService.findEstablishmentsInRadius(
    campaign.centerLat,
    campaign.centerLng,
    campaign.radiusMeters,
    mergedFilters
  );

  if (establishments.length === 0) {
    logger.info(`No establishments found in radius for campaign ${campaignId}`);
    return [];
  }

  const establishmentIds = establishments.map((e) => e.id);
  return assignContactsToCampaign(campaignId, establishmentIds);
};

const startCampaign = async (campaignId, options = {}) => {
  const {
    agentId,
    targetConcurrencyLimit,
    maxRecipientsPerRequest,
    scheduledTimeUnix,
    agentPhoneNumberId,
  } = options;

  const resolvedAgentPhoneNumberId =
    agentPhoneNumberId ||
    process.env.ELEVENLABS_AGENT_PHONE_NUMBER_ID ||
    null;

  const resolvedScheduledTimeUnix = normalizeScheduledTimeUnix(scheduledTimeUnix);

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      name: true,
      status: true,
      agentConfigId: true,
      agentConfigName: true,
      couponPrefix: true,
      offer: true,
      centerLat: true,
      centerLng: true,
      radiusMeters: true,
      filters: true,
      activityCodes: true,
    },
  });

  if (!campaign) {
    const error = new Error("Campaign not found");
    error.statusCode = 404;
    throw error;
  }

  if (campaign.status === "ACTIVE") {
    const error = new Error("Campaign is already active");
    error.statusCode = 409;
    throw error;
  }

  if (campaign.status === "COMPLETED" || campaign.status === "CANCELLED") {
    const error = new Error(`Cannot start campaign with status ${campaign.status}`);
    error.statusCode = 409;
    throw error;
  }

  // Auto-activate SCHEDULED campaigns if their scheduled time has passed
  // If campaign is SCHEDULED and time has passed, clear scheduledTimeUnix to mark as ACTIVE
  if (campaign.status === "SCHEDULED") {
    const now = new Date();
    const scheduledAt = campaign.scheduledAt ? new Date(campaign.scheduledAt) : null;

    if (scheduledAt && scheduledAt <= now) {
      logger.info("[CampaignStart] Auto-activating SCHEDULED campaign (scheduled time has passed)", {
        campaignId,
        scheduledAt,
        now,
      });
      // Clear resolvedScheduledTimeUnix to force ACTIVE status below
      resolvedScheduledTimeUnix = null;
    } else if (scheduledAt && scheduledAt > now) {
      // Campaign is scheduled for future time - don't activate yet
      const error = new Error(`Campaign is scheduled to start at ${scheduledAt.toISOString()}. Current time: ${now.toISOString()}`);
      error.statusCode = 409;
      throw error;
    }
  }

  const resolvedAgentId = agentId || campaign.agentConfigId;
  if (!resolvedAgentId) {
    const error = new Error("agentId is required to start campaign");
    error.statusCode = 400;
    throw error;
  }

  if (!resolvedAgentPhoneNumberId) {
    const error = new Error(
      "agentPhoneNumberId is required to start campaign (or set ELEVENLABS_AGENT_PHONE_NUMBER_ID in .env)"
    );
    error.statusCode = 400;
    throw error;
  }

  const resolvedAgentProfile = await fetchAgentProfile(resolvedAgentId);

  logger.info("[CampaignStart] Resolved ElevenLabs agent profile", {
    campaignId,
    agentId: resolvedAgentId,
    agentName: resolvedAgentProfile.agentName,
    voiceName: resolvedAgentProfile.voiceName,
    voiceId: resolvedAgentProfile.voiceId,
  });

  // Obtener configuración de voz del Agent Builder (demo-form-service) para sobrescribir la de ElevenLabs
  let agentBuilderVoiceId = null;
  let agentBuilderPersonalityName = null;

  try {
    const demoFormUrl = process.env.DEMO_FORM_SERVICE_URL || "http://localhost:3001/api";
    const agentsConfigKey = process.env.AGENTS_CONFIG_KEY;

    // Determinar si es SDR o Calificación basado en el agentId de la campaña
    const sdrAgentId = process.env.ELEVENLABS_SDR_AGENT_ID;
    const qualificationAgentId = process.env.ELEVENLABS_QUALIFICATION_AGENT_ID;

    let configType = "SDR"; // Default a SDR
    if (resolvedAgentId === qualificationAgentId) {
      configType = "QUALIFICATION";
    }

    const configUrl = `${demoFormUrl}/agent-configs/default/${configType}`;
    logger.info(`[CampaignStart] Detectado tipo de agente: ${configType}. Consultando config en: ${configUrl}`);

    const configResponse = await axios.get(configUrl, {
      headers: { "X-API-Key": agentsConfigKey || "" },
      timeout: 5000,
    });

    if (configResponse.data?.success && configResponse.data?.data) {
      const data = configResponse.data.data;
      agentBuilderVoiceId = data.openai_voice || data.voice || null;
      agentBuilderPersonalityName = data.personality_name || null;
      logger.info(`[CampaignStart] Usando configuración de voz por defecto de Agent Builder (${configType})`, {
        voiceId: agentBuilderVoiceId,
        personalityName: agentBuilderPersonalityName
      });
    } else {
      logger.warn(`[CampaignStart] La respuesta del Agent Builder (${configType}) no contenía data válida`);
    }
  } catch (error) {
    logger.warn("[CampaignStart] No se pudo obtener la configuración por defecto de Agent Builder. Se usará la de ElevenLabs.", { error: error.message });
  }

  let contacts = await prisma.campaignContact.findMany({
    where: {
      campaignId,
      status: "PENDING",
    },
    select: {
      id: true,
      campaignId: true,
      establishmentId: true,
      establishmentName: true,
      establishmentPhone: true,
      establishmentData: true,
    },
  });

  if (contacts.length === 0) {
    await assignContactsWithGeoFilter(campaignId, campaign.filters || {});

    contacts = await prisma.campaignContact.findMany({
      where: {
        campaignId,
        status: "PENDING",
      },
      select: {
        id: true,
        campaignId: true,
        establishmentId: true,
        establishmentName: true,
        establishmentPhone: true,
        establishmentData: true,
      },
    });
  }

  if (contacts.length === 0) {
    return {
      success: true,
      message: "No hay contactos pendientes de procesar en esta campaña (todos ya están en proceso o completados)",
      dispatchedCount: 0
    };
  }

  const establishmentIds = [...new Set(contacts.map((contact) => contact.establishmentId).filter(Boolean))];
  let establishments = [];

  if (establishmentIds.length > 0) {
    try {
      establishments = await prismaGeo.establishment.findMany({
        where: {
          id: { in: establishmentIds },
        },
        select: {
          id: true,
          name: true,
          businessName: true,
          phone: true,
          email: true,
          employeeRange: true,
          streetName: true,
          exteriorNumber: true,
          neighborhood: true,
          municipalityName: true,
          stateName: true,
        },
      });
    } catch (geoError) {
      logger.warn("Geo DB lookup failed while starting campaign, using campaign contact snapshot only", {
        campaignId,
        error: geoError.message,
      });
    }
  }

  const establishmentById = new Map(establishments.map((establishment) => [establishment.id, establishment]));

  // Construir contexto de campaña para pasar a ElevenLabs
  // IMPORTANTE: Solo se incluye cuando la llamada se dispara desde una campaña
  const campaignContext = await campaignContextService.buildCampaignContext(campaignId, null);

  const recipients = await Promise.all(contacts.map(async (contact) => {
    const establishment = establishmentById.get(contact.establishmentId);
    const contactData =
      contact.establishmentData && typeof contact.establishmentData === "object"
        ? contact.establishmentData
        : {};

    const businessName =
      contact.establishmentName ||
      establishment?.name ||
      contactData.name ||
      contactData.businessName ||
      null;

    const prospectName =
      contactData.prospectName ||
      contactData.decisionMakerName ||
      contactData.contactName ||
      businessName ||
      "Prospecto";

    const establishmentName = businessName || "Establecimiento";
    const decisionMakerName =
      contactData.decisionMakerName ||
      contactData.prospectName ||
      contactData.contactName ||
      prospectName ||
      "Prospecto";
    const agentName =
      contactData.agentName ||
      resolvedAgentProfile.agentName ||
      campaign.agentConfigName ||
      "Asesor EasyOrder";

    // Prioridad 1: Agent Builder, Prioridad 2: ElevenLabs, Prioridad 3: Contact Data
    const personalityName =
      agentBuilderPersonalityName ||
      resolvedAgentProfile.voiceName ||
      resolvedAgentProfile.voiceId ||
      contactData.personality_name ||
      contactData.personalityName ||
      agentName;

    const finalVoiceName = agentBuilderPersonalityName || resolvedAgentProfile.voiceName || null;
    const finalVoiceId = agentBuilderVoiceId || resolvedAgentProfile.voiceId || null;

    const phoneNumber =
      contact.establishmentPhone ||
      establishment?.phone ||
      contactData.phone ||
      contactData.whatsapp ||
      null;

    const email =
      contactData.email ||
      contactData.decisionMakerEmail ||
      establishment?.email ||
      "";

    // Enriquecer contexto de campaña con datos específicos del contacto
    const contactSpecificContext = campaignContext ? {
      ...campaignContext,
      contactId: contact.id,
      establishmentName: establishmentName,
      prospectName: prospectName,
      phoneNumber: phoneNumber
    } : null;

    return {
      campaignContactId: contact.id,
      phone_number: phoneNumber,
      dynamic_variables: {
        campaignId,
        campaignContactId: contact.id,
        prospectName,
        businessName,
        establishmentName,
        decisionMakerName,
        agentName,
        voiceName: finalVoiceName,
        voice_name: finalVoiceName,
        voiceId: finalVoiceId,
        voice_id: finalVoiceId,
        establishment_name: establishmentName,
        decision_maker_name: decisionMakerName,
        agent_name: agentName,
        companyName: establishmentName,
        company_name: establishmentName,
        contactName: decisionMakerName,
        contact_name: decisionMakerName,
        leadName: decisionMakerName,
        lead_name: decisionMakerName,
        agentConfigId: resolvedAgentId,
        campaignName: campaign.name || null,
        campaignOffer: campaign.offer || null,
        personality_name: personalityName,
        personalityName: personalityName,
        phone: phoneNumber,
        phone_number: phoneNumber,
        phoneNumber: phoneNumber,
        email: email,
        decisionMakerEmail: email,
        decision_maker_email: email,
        // Contexto de campaña para ElevenLabs (Convertidos a string para evitar "CADENA VACÍA")
        campaignContext: contactSpecificContext ? JSON.stringify(contactSpecificContext) : "",
        couponsAvailable: contactSpecificContext?.coupons?.available ? "true" : "false",
        couponTypes: contactSpecificContext?.coupons?.templates?.map(t => t.type).join(", ") || "",
        couponType: contactSpecificContext?.coupons?.couponType || campaign.couponPrefix || contactData.couponType || null,
        couponSendEndpoint: "/api/v1/coupons-whatsapp/generate-and-send",
        agentInstructions: contactSpecificContext?.agentInstructions || null
      },
    };
  }));

  logger.info("[CampaignStart] Dynamic variables preview", {
    campaignId,
    agentId: resolvedAgentId,
    firstRecipient: recipients[0]
      ? {
        campaignContactId: recipients[0].campaignContactId,
        phoneNumber: recipients[0].phone_number,
        agent_name: recipients[0].dynamic_variables?.agent_name,
        voice_id: recipients[0].dynamic_variables?.voice_id,
        personality_name: recipients[0].dynamic_variables?.personality_name,
      }
      : null,
  });

  const dispatchResult = await campaignBatchDispatcherService.submitCampaignBatch({
    campaignId,
    recipients,
    agentId: resolvedAgentId,
    targetConcurrencyLimit,
    maxRecipientsPerRequest,
    scheduledTimeUnix: resolvedScheduledTimeUnix,
    callName: `campaign-${campaign.name}`,
    agentPhoneNumberId: resolvedAgentPhoneNumberId,
  });

  const invalidContactReasons = new Map();
  for (const invalidEntry of dispatchResult.invalidRecipients || []) {
    const campaignContactId = invalidEntry?.recipient?.dynamic_variables?.campaignContactId;
    if (!campaignContactId) {
      continue;
    }
    invalidContactReasons.set(campaignContactId, invalidEntry.reason || "Invalid recipient");
  }

  const dispatchedContactIds = recipients
    .map((recipient) => recipient.campaignContactId)
    .filter(Boolean);

  // Determinar estado según si está programada o no
  const campaignStatus = resolvedScheduledTimeUnix ? "SCHEDULED" : "ACTIVE";
  const contactStatus = resolvedScheduledTimeUnix ? "SCHEDULED" : "CALLING";

  await prisma.$transaction([
    prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: campaignStatus,
        startedAt: new Date(),
        scheduledAt: resolvedScheduledTimeUnix
          ? new Date(resolvedScheduledTimeUnix * 1000)
          : null,
      },
    }),
    ...Array.from(invalidContactReasons.entries()).map(([contactId, reason]) =>
      prisma.campaignContact.update({
        where: { id: contactId },
        data: {
          status: "FAILED",
          errorReason: reason,
        },
      })
    ),
  ]);

  logger.info("Campaign started with batch dispatch", {
    campaignId,
    agentId: resolvedAgentId,
    status: campaignStatus,
    totalRecipients: recipients.length,
    requestedScheduledTimeUnix: scheduledTimeUnix || null,
    resolvedScheduledTimeUnix: resolvedScheduledTimeUnix || null,
    dispatchedRecipients: dispatchResult.dispatchedRecipients,
    skippedRecipients: dispatchResult.skippedRecipients,
    providerBatchIds: dispatchResult.providerBatchIds,
  });

  return {
    campaignId,
    status: campaignStatus,
    startedAt: new Date().toISOString(),
    scheduledFor: resolvedScheduledTimeUnix ? new Date(resolvedScheduledTimeUnix * 1000).toISOString() : null,
    dispatch: dispatchResult,
  };
};

const getCampaignContacts = async (campaignId, filters = {}) => {
  const { status, page = 1, limit = 50 } = filters;

  const where = { campaignId };
  if (status) where.status = status;

  const [contacts, total] = await Promise.all([
    prisma.campaignContact.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        coupon: true,
      },
    }),
    prisma.campaignContact.count({ where }),
  ]);

  return {
    contacts,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const updateContactStatus = async (contactId, status, metadata = {}) => {
  const validStatuses = [
    "PENDING",
    "CALLING",
    "PAUSED",
    "CALLED",
    "RESPONDED",
    "SENT",
    "DELIVERED",
    "VISITED",
    "CONVERTED",
    "FAILED",
  ];
  if (!validStatuses.includes(status)) {
    throw new Error(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
  }

  const updateData = { status };

  if (status === "SENT" && !metadata.sentAt) {
    updateData.sentAt = new Date();
  }
  if (status === "VISITED" && !metadata.visitedAt) {
    updateData.visitedAt = new Date();
  }
  if (status === "CONVERTED" && !metadata.convertedAt) {
    updateData.convertedAt = new Date();
  }
  if (metadata.messageId) {
    updateData.messageId = metadata.messageId;
  }
  if (metadata.errorReason) {
    updateData.errorReason = metadata.errorReason;
  }

  const contact = await prisma.campaignContact.update({
    where: { id: contactId },
    data: updateData,
  });

  const campaign = await prisma.campaign.findUnique({
    where: { id: contact.campaignId },
  });

  if (status === "SENT" || status === "DELIVERED" || status === "CALLED") {
    await prisma.campaign.update({
      where: { id: contact.campaignId },
      data: { totalCalled: { increment: 1 } },
    });
  } else if (status === "RESPONDED" || status === "VISITED") {
    await prisma.campaign.update({
      where: { id: contact.campaignId },
      data: { totalResponded: { increment: 1 } },
    });
  } else if (status === "CONVERTED") {
    await prisma.campaign.update({
      where: { id: contact.campaignId },
      data: { totalConverted: { increment: 1 } },
    });
  } else if (status === "FAILED") {
    await prisma.campaign.update({
      where: { id: contact.campaignId },
      data: { totalFailed: { increment: 1 } },
    });
  }

  logger.info(`Contact ${contactId} status updated to ${status}`);
  return contact;
};

const getCampaignStats = async (campaignId) => {
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
    throw new Error("Campaign not found");
  }

  const statusBreakdown = await prisma.campaignContact.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: true,
  });

  // Get conversions by day for the last 7 days
  const convertedContacts = await prisma.campaignContact.findMany({
    where: {
      campaignId,
      status: "CONVERTED",
      convertedAt: {
        not: null,
      },
    },
    select: {
      convertedAt: true,
    },
  });

  // Group conversions by day
  const conversionsByDay = {};
  convertedContacts.forEach((contact) => {
    if (contact.convertedAt) {
      const date = new Date(contact.convertedAt);
      const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
      conversionsByDay[dateKey] = (conversionsByDay[dateKey] || 0) + 1;
    }
  });

  // Create array for last 7 days
  const conversionTimeline = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateKey = date.toISOString().split('T')[0];
    conversionTimeline.push({
      date: dateKey,
      conversions: conversionsByDay[dateKey] || 0,
    });
  }

  const metricsByStatus = statusBreakdown.reduce((acc, group) => {
    acc[group.status] = group._count;
    return acc;
  }, {});

  const totalContacts = campaign._count.contacts;
  const totalCalled =
    (metricsByStatus.CALLING || 0) +
    (metricsByStatus.CALLED || 0) +
    (metricsByStatus.RESPONDED || 0) +
    (metricsByStatus.SENT || 0) +
    (metricsByStatus.DELIVERED || 0) +
    (metricsByStatus.VISITED || 0) +
    (metricsByStatus.CONVERTED || 0) +
    (metricsByStatus.FAILED || 0);

  const totalResponded = (metricsByStatus.RESPONDED || 0) + (metricsByStatus.VISITED || 0);
  const totalConverted = metricsByStatus.CONVERTED || 0;
  const totalFailed = metricsByStatus.FAILED || 0;

  const responseRate = totalCalled > 0 ? (totalResponded / totalCalled) * 100 : 0;
  const conversionRate = totalResponded > 0 ? (totalConverted / totalResponded) * 100 : 0;

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
    },
    metrics: {
      totalContacts,
      totalCalled,
      totalResponded,
      totalConverted,
      totalFailed,
      totalCoupons: campaign._count.coupons,
      responseRate: responseRate.toFixed(2),
      conversionRate: conversionRate.toFixed(2),
    },
    statusBreakdown: metricsByStatus,
    conversionTimeline: conversionTimeline,
  };
};

const pauseCampaign = async (campaignId) => {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
  });

  if (!campaign) {
    const error = new Error("Campaign not found");
    error.statusCode = 404;
    throw error;
  }

  if (campaign.status !== "ACTIVE") {
    const error = new Error(`Campaign must be ACTIVE to pause. Current status: ${campaign.status}`);
    error.statusCode = 409;
    throw error;
  }

  // Contar contactos que están en CALLING para logging
  const callingContactsCount = await prisma.campaignContact.count({
    where: {
      campaignId,
      status: "CALLING",
    },
  });

  // Congelar llamadas en curso para evitar redials al reanudar
  const pausedContactsResult = await prisma.campaignContact.updateMany({
    where: {
      campaignId,
      status: "CALLING",
    },
    data: {
      status: "PAUSED",
    },
  });

  const updatedCampaign = await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      status: "PAUSED",
    },
  });

  logger.info(`Campaign paused: ${campaignId}`, {
    campaignId,
    previousStatus: campaign.status,
    newStatus: updatedCampaign.status,
    callingContactsCount,
    pausedContactsCount: pausedContactsResult.count,
  });

  return updatedCampaign;
};

const cancelCampaign = async (id) => {
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) throw new Error("Campaña no encontrada");
  if (campaign.status === "COMPLETED" || campaign.status === "CANCELLED") {
    throw new Error("La campaña ya ha finalizado");
  }

  return prisma.campaign.update({
    where: { id },
    data: { status: "CANCELLED" },
  });
};

const retryCampaignContacts = async (campaignId, options = {}) => {
  const { includeFailed = true, includeStaleCalling = true } = options;
  const statuses = [];
  if (includeFailed) statuses.push("FAILED");
  if (includeStaleCalling) statuses.push("CALLING");

  if (statuses.length === 0) return { updatedCount: 0 };

  const result = await prisma.campaignContact.updateMany({
    where: {
      campaignId,
      status: { in: statuses },
    },
    data: {
      status: "PENDING",
      providerBatchId: null,
      errorReason: null,
    },
  });

  logger.info("[CampaignRetry] Contacts reset for retry", {
    campaignId,
    updatedCount: result.count,
    statuses,
  });

  return {
    success: true,
    updatedCount: result.count,
    message: `${result.count} contactos reseteados correctamente para re-intento`,
  };
};

const resumeCampaign = async (campaignId) => {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
  });

  if (!campaign) {
    const error = new Error("Campaign not found");
    error.statusCode = 404;
    throw error;
  }

  if (campaign.status !== "PAUSED" && campaign.status !== "ACTIVE") {
    const error = new Error(`Campaign must be PAUSED or ACTIVE to resume/reconcile. Current status: ${campaign.status}`);
    error.statusCode = 409;
    throw error;
  }

  // Reconciliar contactos que quedaron stuck en CALLING/PAUSED
  // Estos son contactos cuya llamada pudo haber completado mientras la campaña estaba pausada
  const stuckCallingContacts = await prisma.campaignContact.findMany({
    where: {
      campaignId,
      status: { in: ["CALLING", "PAUSED"] },
    },
    select: {
      id: true,
      webhookReceivedAt: true,
      conversationId: true,
      providerBatchId: true,
      sentAt: true,
      updatedAt: true,
      createdAt: true,
    },
  });

  // Reconciliar contactos stuck
  let reconciliedCount = 0;
  let relaunchedCount = 0;
  let waitingWebhookCount = 0;
  let closedWithoutWebhookCount = 0;

  if (stuckCallingContacts.length > 0) {
    const now = new Date();
    const WEBHOOK_GRACE_MINUTES = 5; // Evita relanzar si el webhook llega con retraso corto
    const CALLING_TIMEOUT_MINUTES = 30; // Si estuvo CALLING más de 30 min sin webhook, resetear a PENDING

    for (const contact of stuckCallingContacts) {
      // Releer estado actual para evitar carreras con webhooks que llegan durante el resume
      const latestContact = await prisma.campaignContact.findUnique({
        where: { id: contact.id },
        select: {
          id: true,
          status: true,
          webhookReceivedAt: true,
          conversationId: true,
          providerBatchId: true,
          sentAt: true,
          updatedAt: true,
          createdAt: true,
        },
      });

      if (!latestContact) {
        continue;
      }

      if (!["CALLING", "PAUSED"].includes(latestContact.status)) {
        logger.info(`Contact ${latestContact.id} skipped in resume reconciliation (status changed to ${latestContact.status})`);
        continue;
      }

      const referenceTimestamp =
        latestContact.sentAt || latestContact.updatedAt || latestContact.createdAt;
      const timeInCallingMs = now.getTime() - new Date(referenceTimestamp).getTime();
      const timeInCallingMinutes = timeInCallingMs / (1000 * 60);

      // Si el webhook fue recibido, marcar como CALLED (la llamada se completó)
      if (latestContact.webhookReceivedAt) {
        const finalStatus = ["CALLED", "RESPONDED", "FAILED", "SENT"].includes(latestContact.status)
          ? latestContact.status
          : "CALLED";

        await prisma.campaignContact.update({
          where: { id: latestContact.id },
          data: { status: finalStatus },
        });
        reconciliedCount++;
        logger.info(`Contact ${latestContact.id} reconciled: ${latestContact.status} → ${finalStatus} (webhook received)`);
      }
      // Especial para contactos en PAUSED sin webhook pero con evidencia de que NO se despacharon o fallaron silenciosamente
      else if (latestContact.status === "PAUSED" && !latestContact.providerBatchId) {
        await prisma.campaignContact.update({
          where: { id: latestContact.id },
          data: {
            status: "PENDING",
            sentAt: null,
            providerBatchId: null,
            conversationId: null,
            errorReason: null
          },
        });
        reconciliedCount++;
        relaunchedCount++;
        logger.info(`Contact ${latestContact.id} reconciled: PAUSED → PENDING (no provider/webhook evidence, ready to retry)`);
      }
      // Si ya fue despachado al proveedor (providerBatchId), NO relanzar para evitar duplicados.
      // Esperar webhook y, si expira timeout, cerrarlo sin redial.
      else if (latestContact.providerBatchId) {
        if (timeInCallingMinutes > CALLING_TIMEOUT_MINUTES) {
          await prisma.campaignContact.update({
            where: { id: latestContact.id },
            data: {
              status: "FAILED",
              errorReason: "Call dispatched to provider but webhook was not received before timeout (30m+)",
            },
          });
          reconciliedCount++;
          closedWithoutWebhookCount++;
          logger.warn(`Contact ${latestContact.id} reconciled: ${latestContact.status} → FAILED (provider dispatch confirmed, timeout without webhook)`);
        } else {
          if (latestContact.status === "PAUSED") {
            // Regresarlo a CALLING porque ya está en ElevenLabs, estamos esperando el webhook
            await prisma.campaignContact.update({
              where: { id: latestContact.id },
              data: { status: "CALLING" },
            });
            reconciliedCount++;
            waitingWebhookCount++;
            logger.info(`Contact ${latestContact.id} reconciled: PAUSED → CALLING (provider dispatch confirmed, awaiting webhook ${timeInCallingMinutes.toFixed(1)}m)`);
          } else {
            waitingWebhookCount++;
            logger.info(`Contact ${latestContact.id} remains ${latestContact.status} (provider dispatch confirmed, awaiting webhook ${timeInCallingMinutes.toFixed(1)}m)`);
          }
        }
      }
      // Sin evidencia de despacho al proveedor: esperar gracia corta y luego relanzar.
      else {
        if (timeInCallingMinutes <= WEBHOOK_GRACE_MINUTES) {
          waitingWebhookCount++;
          logger.info(
            `Contact ${latestContact.id} remains ${latestContact.status} (grace period ${timeInCallingMinutes.toFixed(1)}m/${WEBHOOK_GRACE_MINUTES}m)`
          );
        } else {
          await prisma.campaignContact.update({
            where: { id: latestContact.id },
            data: {
              status: "PENDING",
              sentAt: null,
              providerBatchId: null,
              conversationId: null,
              errorReason: null
            },
          });
          reconciliedCount++;
          relaunchedCount++;
          logger.info(`Contact ${latestContact.id} reconciled: ${latestContact.status} → PENDING (no webhook after grace, will relaunch)`);
        }
      }
    }
  }

  // Obtener contactos pending que no se han llamado todavía (incluye los que acaban de ser reconciliados)
  const pendingContacts = await prisma.campaignContact.findMany({
    where: {
      campaignId,
      status: "PENDING",
    },
    select: {
      id: true,
      campaignId: true,
      establishmentId: true,
      establishmentName: true,
      establishmentPhone: true,
      establishmentData: true,
    },
  });

  if (pendingContacts.length === 0 && stuckCallingContacts.length === 0) {
    logger.warn(`No pending contacts found to resume for campaign ${campaignId}`);
  }

  // Si hay pendientes, re-despachar llamadas para que continúen automáticamente
  if (pendingContacts.length > 0) {
    const startResult = await startCampaign(campaignId, {
      agentId: campaign.agentConfigId,
    });

    // Actualizar estado de la campaña explícitamente a ACTIVE
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "ACTIVE" },
    });

    logger.info(`Campaign resumed with redispatch: ${campaignId}`, {
      campaignId,
      previousStatus: campaign.status,
      newStatus: "ACTIVE",
      pendingContactsCount: pendingContacts.length,
      stuckCallingContactsCount: stuckCallingContacts.length,
      reconciliedContactsCount: reconciliedCount,
      relaunchedContactsCount: relaunchedCount,
      waitingWebhookContactsCount: waitingWebhookCount,
      closedWithoutWebhookContactsCount: closedWithoutWebhookCount,
      dispatchedRecipients: startResult.dispatch?.dispatchedRecipients,
    });

    return {
      campaignId,
      status: "ACTIVE",
      startedAt: startResult.startedAt,
      dispatch: startResult.dispatch,
      pendingContacts: pendingContacts.length,
      stuckCallingContacts: stuckCallingContacts.length,
      reconciliedContacts: reconciliedCount,
      relaunchedContacts: relaunchedCount,
      waitingWebhookContacts: waitingWebhookCount,
      closedWithoutWebhookContacts: closedWithoutWebhookCount,
    };
  }

  const updatedCampaign = await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      status: "ACTIVE",
    },
  });

  logger.info(`Campaign resumed without redispatch: ${campaignId}`, {
    campaignId,
    previousStatus: campaign.status,
    newStatus: updatedCampaign.status,
    pendingContactsCount: pendingContacts.length,
    stuckCallingContactsCount: stuckCallingContacts.length,
    reconciliedContactsCount: reconciliedCount,
    waitingWebhookContactsCount: waitingWebhookCount,
    closedWithoutWebhookContactsCount: closedWithoutWebhookCount,
  });

  return {
    ...updatedCampaign,
    pendingContacts: pendingContacts.length,
    stuckCallingContacts: stuckCallingContacts.length,
    reconciliedContacts: reconciliedCount,
    waitingWebhookContacts: waitingWebhookCount,
    closedWithoutWebhookContacts: closedWithoutWebhookCount,
  };
};

/**
 * Get coupon breakdown analytics by type for a campaign
 * @param {string} campaignId - Campaign ID
 * @returns {Promise<object>} Breakdown of coupons by type with metrics
 */
const getCouponBreakdown = async (campaignId) => {
  // Get campaign to verify it exists
  const campaign = await getCampaignById(campaignId);

  // Group coupons by type with aggregated metrics
  const breakdown = await prisma.campaignCoupon.groupBy({
    by: ["couponType"],
    where: {
      campaignId,
      couponType: { not: null }
    },
    _count: {
      _all: true,
    },
    _sum: {
      visitCount: true,
    },
  });

  // Get conversion counts per coupon type
  const conversionsByType = await prisma.campaignCoupon.groupBy({
    by: ["couponType"],
    where: {
      campaignId,
      status: "CONVERTED",
      couponType: { not: null }
    },
    _count: {
      _all: true,
    },
  });

  // Get visited counts per coupon type
  const visitedByType = await prisma.campaignCoupon.groupBy({
    by: ["couponType"],
    where: {
      campaignId,
      status: "VISITED",
      couponType: { not: null }
    },
    _count: {
      _all: true,
    },
  });

  // Map conversions and visits to coupon types
  const conversionsMap = {};
  conversionsByType.forEach((item) => {
    conversionsMap[item.couponType] = item._count._all;
  });

  const visitedMap = {};
  visitedByType.forEach((item) => {
    visitedMap[item.couponType] = item._count._all;
  });

  // Get template details for each coupon type
  const couponTypes = breakdown.map((item) => item.couponType);
  const templates = await prisma.couponTemplate.findMany({
    where: {
      couponType: { in: couponTypes },
    },
    select: {
      couponType: true,
      name: true,
      description: true,
      percentOff: true,
      durationMonths: true,
      trialDays: true,
    },
  });

  const templatesMap = {};
  templates.forEach((template) => {
    templatesMap[template.couponType] = template;
  });

  // Build enriched breakdown with metrics
  const enrichedBreakdown = breakdown.map((item) => {
    const sent = item._count._all;
    const visited = visitedMap[item.couponType] || 0;
    const converted = conversionsMap[item.couponType] || 0;
    const template = templatesMap[item.couponType];

    return {
      couponType: item.couponType,
      name: template?.name || item.couponType,
      description: template?.description || null,
      offer: template
        ? `${template.percentOff ? template.percentOff + "%" : ""} ${template.durationMonths ? template.durationMonths + " meses" : ""
          } ${template.trialDays ? template.trialDays + " días trial" : ""}`.trim()
        : null,
      metrics: {
        sent,
        visited,
        converted,
        visitRate: sent > 0 ? ((visited / sent) * 100).toFixed(2) : "0.00",
        conversionRate: sent > 0 ? ((converted / sent) * 100).toFixed(2) : "0.00",
        totalVisits: item._sum.visitCount || 0,
      },
    };
  });

  // Sort by sent count descending
  enrichedBreakdown.sort((a, b) => b.metrics.sent - a.metrics.sent);

  // Calculate totals
  const totals = {
    sent: enrichedBreakdown.reduce((sum, item) => sum + item.metrics.sent, 0),
    visited: enrichedBreakdown.reduce((sum, item) => sum + item.metrics.visited, 0),
    converted: enrichedBreakdown.reduce((sum, item) => sum + item.metrics.converted, 0),
    totalVisits: enrichedBreakdown.reduce((sum, item) => sum + item.metrics.totalVisits, 0),
  };

  totals.visitRate = totals.sent > 0 ? ((totals.visited / totals.sent) * 100).toFixed(2) : "0.00";
  totals.conversionRate = totals.sent > 0 ? ((totals.converted / totals.sent) * 100).toFixed(2) : "0.00";

  logger.info("Coupon breakdown retrieved", {
    campaignId,
    couponTypes: enrichedBreakdown.length,
    totalSent: totals.sent,
  });

  return {
    campaignId,
    campaignName: campaign.name,
    breakdown: enrichedBreakdown,
    totals,
    generatedAt: new Date().toISOString(),
  };
};

module.exports = {
  createCampaign,
  getCampaignById,
  listCampaigns,
  updateCampaign,
  deleteCampaign,
  assignContactsToCampaign,
  assignContactsWithGeoFilter,
  startCampaign,
  getCampaignContacts,
  updateContactStatus,
  getCampaignStats,
  pauseCampaign,
  resumeCampaign,
  getCouponBreakdown,
  cancelCampaign,
  retryCampaignContacts,
};
