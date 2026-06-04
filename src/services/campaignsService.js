const { randomUUID } = require("crypto");
const prisma = require("../config/database");
const prismaGeo = require("../config/database-geo");
const logger = require("../config/logger");
const axios = require("axios");
const geoService = require("./geoService");
const campaignBatchDispatcherService = require("./campaignBatchDispatcherService");
const campaignContextService = require("./campaignContextService");

const ELEVENLABS_AGENTS_URL = process.env.ELEVENLABS_AGENTS_URL || "https://api.elevenlabs.io/v1/convai/agents";

const AGENT_TO_CAMPAIGN_TYPE_MAP = {
  'agent_5101kn32vm9gevjaqrrhx2hh537h': 'DISCOVERY',
  'agent_6701kn5n423cemxv9n9pwvs5nj2t': 'QUALIFICATION',
  'agent_3901kn500d46f9bvce4w254zcfw7': 'ACTIVATION',
  'agent_4701kn5nyqwaf2ntj1cgsnxsv31p': 'CONVERSION',
};
/**
 * Obtiene el tipo de campaña basado en el ID del agente
 * @param {string} agentConfigId - ID del agente de ElevenLabs
 * @returns {string|null} - Tipo de campaña o null si no es válido
 */
function getCampaignTypeFromAgent(agentConfigId) {
  return AGENT_TO_CAMPAIGN_TYPE_MAP[agentConfigId] || null;
}

/**
 * Obtiene la lista de IDs de agentes válidos para campañas
 * @returns {string[]} - Array de IDs de agentes
 */
function getValidCampaignAgentIds() {
  return Object.keys(AGENT_TO_CAMPAIGN_TYPE_MAP);
}



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

// Etapas lineales del funnel. Sin registro / sin status del funnel = rank 0.
const FUNNEL_STATUSES = [
  'discovery_completed',
  'qualification_completed',
  'activation_completed',
  'conversion_completed',
];

const STAGE_RANK = {
  discovery_completed: 1,
  qualification_completed: 2,
  activation_completed: 3,
  conversion_completed: 4,
};

const CAMPAIGN_RANK = {
  DISCOVERY: 1,
  QUALIFICATION: 2,
  ACTIVATION: 3,
  CONVERSION: 4,
};

// Siguiente etapa en el funnel para la feature de "continuar campaña"
const NEXT_STAGE = {
  DISCOVERY: 'QUALIFICATION',
  QUALIFICATION: 'ACTIVATION',
  ACTIVATION: 'CONVERSION',
  CONVERSION: null,
};

// Inverso de AGENT_TO_CAMPAIGN_TYPE_MAP — usado por continueCampaign
const CAMPAIGN_TYPE_TO_AGENT = Object.fromEntries(
  Object.entries(AGENT_TO_CAMPAIGN_TYPE_MAP).map(([k, v]) => [v, k])
);

const CAMPAIGN_TYPE_TO_AGENT_NAME = {
  DISCOVERY: 'Agente Discovery',
  QUALIFICATION: 'Agente Qualification',
  ACTIVATION: 'Agente Activation',
  CONVERSION: 'Agente Conversion',
};

const COUPON_REQUIRED_TYPES = ['ACTIVATION', 'CONVERSION'];

// Compatibilidad con consumidores actuales: status exacto inmediatamente anterior.
const STAGE_PREREQUISITES = {
  DISCOVERY: null,
  QUALIFICATION: 'discovery_completed',
  ACTIVATION: 'qualification_completed',
  CONVERSION: 'activation_completed',
};

const PRIOR_STAGE_DISPLAY = {
  DISCOVERY: null,
  QUALIFICATION: 'Discovery',
  ACTIVATION: 'Qualification',
  CONVERSION: 'Activation',
};

function getStageRank(enrichmentStatus) {
  if (!enrichmentStatus) return 0;
  return STAGE_RANK[enrichmentStatus] ?? 0;
}

// Clasifica establishments según el funnel para una campaña de tipo X:
// - eligibleIds: rank == campaignRank - 1 (etapa inmediatamente anterior)
// - excludedNoPrereq: rank < campaignRank - 1 (aun no llegan a la etapa requerida)
// - excludedAdvanced: rank >= campaignRank (igual o posterior a la etapa objetivo;
//   no deben recibir la campaña para no sobrescribir su progreso)
async function classifyEstablishmentsByStage(establishmentIds, campaignType) {
  const ids = [...new Set((establishmentIds || []).filter(Boolean))];
  const campaignRank = CAMPAIGN_RANK[campaignType];
  if (!campaignRank || ids.length === 0) {
    return { eligibleIds: ids, excludedNoPrereq: 0, excludedAdvanced: 0 };
  }
  const requiredPriorRank = campaignRank - 1;

  // Solo nos interesan los que tienen un status del funnel; el resto es rank 0.
  const records = await prisma.establishmentEnrichment.findMany({
    where: {
      establishmentId: { in: ids },
      enrichmentStatus: { in: FUNNEL_STATUSES },
    },
    select: { establishmentId: true, enrichmentStatus: true },
  });
  const rankById = new Map(
    records.map(r => [r.establishmentId, getStageRank(r.enrichmentStatus)])
  );

  const eligibleIds = [];
  let excludedNoPrereq = 0;
  let excludedAdvanced = 0;

  for (const id of ids) {
    const rank = rankById.get(id) ?? 0;
    if (rank === requiredPriorRank) eligibleIds.push(id);
    else if (rank < requiredPriorRank) excludedNoPrereq++;
    else excludedAdvanced++;
  }

  return { eligibleIds, excludedNoPrereq, excludedAdvanced };
}


const REENGAGEMENT_VALID_OUTCOMES = [
  'NO_ANSWER', 'VOICEMAIL', 'FOLLOW_UP_LATER',
  'OBJECTION_UNRESOLVED', 'DEMO_DECLINED', 'NOT_INTERESTED', 'DISQUALIFIED',
];
const REENGAGEMENT_VALID_CAMPAIGN_TYPES = ['DISCOVERY', 'QUALIFICATION', 'ACTIVATION', 'CONVERSION'];

// Retorna establecimientos candidatos para una campaña de reenganche.
// Filtra por outcome guardado en CampaignContact.establishmentData, rango de fechas,
// tipo de campaña origen, y opcionalmente excluye contacts en campañas activas o clients.
const getReengagementCandidates = async ({
  sourceCampaignId,
  outcomes = ['NO_ANSWER', 'VOICEMAIL', 'FOLLOW_UP_LATER'],
  lastCalledFrom,
  lastCalledTo,
  campaignTypes = ['ACTIVATION', 'CONVERSION'],
  agentConfigId,
  excludeActiveCampaigns = true,
  excludeClients = true,
  limit = 500,
} = {}) => {
  const safeLimit = Math.min(Math.max(1, parseInt(limit) || 500), 1000);
  // Validar contra whitelist para construir SQL inline de forma segura
  const safeOutcomes = outcomes.filter(o => REENGAGEMENT_VALID_OUTCOMES.includes(o));
  const safeTypes = campaignTypes.filter(t => REENGAGEMENT_VALID_CAMPAIGN_TYPES.includes(t));

  if (safeOutcomes.length === 0) safeOutcomes.push('NO_ANSWER', 'VOICEMAIL', 'FOLLOW_UP_LATER');
  if (safeTypes.length === 0) safeTypes.push('ACTIVATION', 'CONVERSION');

  const fromDate = lastCalledFrom ? new Date(lastCalledFrom) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const toDate = lastCalledTo ? new Date(lastCalledTo) : new Date();

  // Literales SQL seguros (validados contra whitelist, no input directo de usuario)
  const outcomesLiteral = safeOutcomes.map(o => `'${o}'`).join(',');
  const typesLiteral = safeTypes.map(t => `'${t}'`).join(',');

  const queryParams = [fromDate, toDate, safeLimit];
  let paramIdx = 3;

  let whereClauses = `
    cc.establishment_data->>'outcome' IN (${outcomesLiteral})
    AND c.status = 'COMPLETED'
    AND c.type::text IN (${typesLiteral})
    AND cc.updated_at >= $1
    AND cc.updated_at <= $2
  `;

  if (sourceCampaignId) {
    queryParams.push(sourceCampaignId);
    whereClauses += ` AND cc.campaign_id = $${++paramIdx}`;
  }

  if (agentConfigId) {
    queryParams.push(agentConfigId);
    whereClauses += ` AND c.agent_config_id = $${++paramIdx}`;
  }

  if (excludeClients) {
    whereClauses += ` AND (ee.level IS NULL OR ee.level::text != 'CLIENT')`;
  }

  const activeExcludeSubquery = excludeActiveCampaigns
    ? `AND cc.establishment_id NOT IN (
        SELECT DISTINCT cc2.establishment_id
        FROM campaign_contacts cc2
        JOIN campaigns c2 ON c2.id = cc2.campaign_id
        WHERE c2.status::text IN ('ACTIVE', 'SCHEDULED')
      )`
    : '';

  // Siempre excluir contactos que ya convirtieron (CLOSED_WON) en cualquier campaña pasada,
  // como barrera adicional cuando level=CLIENT aún no se ha persistido en enrichment
  const closedWonExcludeSubquery = `
    AND cc.establishment_id NOT IN (
      SELECT DISTINCT cc3.establishment_id
      FROM campaign_contacts cc3
      WHERE cc3.establishment_data->>'outcome' = 'CLOSED_WON'
    )
  `;

  // DISTINCT ON mantiene la llamada más reciente por establishment_id
  const query = `
    SELECT DISTINCT ON (cc.establishment_id)
      cc.establishment_id AS "establishmentId",
      cc.establishment_name AS "establishmentName",
      cc.establishment_phone AS "establishmentPhone",
      cc.establishment_data->>'outcome' AS outcome,
      cc.updated_at AS "lastCalledAt",
      c.id AS "sourceCampaignId",
      c.name AS "sourceCampaignName",
      ee.level
    FROM campaign_contacts cc
    JOIN campaigns c ON c.id = cc.campaign_id
    LEFT JOIN establishment_enrichments ee ON ee.establishment_id = cc.establishment_id
    WHERE ${whereClauses}
    ${activeExcludeSubquery}
    ${closedWonExcludeSubquery}
    ORDER BY cc.establishment_id, cc.updated_at DESC
    LIMIT $3
  `;

  const candidates = await prisma.$queryRawUnsafe(query, ...queryParams);

  const byOutcome = {};
  const byLevel = {};
  for (const c of candidates) {
    byOutcome[c.outcome] = (byOutcome[c.outcome] || 0) + 1;
    const lvl = c.level || 'UNKNOWN';
    byLevel[lvl] = (byLevel[lvl] || 0) + 1;
  }

  logger.info('[campaignsService:getReengagementCandidates] Query completed', {
    total: candidates.length,
    sourceCampaignId: sourceCampaignId || null,
    appliedFilters: { safeOutcomes, safeTypes, excludeActiveCampaigns, excludeClients },
  });

  return {
    candidates,
    total: candidates.length,
    breakdown: { byOutcome, byLevel },
    appliedFilters: {
      outcomes: safeOutcomes,
      lastCalledFrom: fromDate.toISOString(),
      lastCalledTo: toDate.toISOString(),
      campaignTypes: safeTypes,
      agentConfigId: agentConfigId || null,
      excludeActiveCampaigns,
      excludeClients,
      sourceCampaignId: sourceCampaignId || null,
      limit: safeLimit,
    },
  };
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
    // Reenganche: lista pre-armada de IDs, omite filtro geo
    establishmentIds,
    sourceCampaignId,
    // CSV: contactos importados desde archivo
    csvContacts,
    contactSource,
    csvMetadata,
  } = data;

  if (!name) {
    throw new Error("Campaign name is required");
  }

  // Validar que se proporcione un agente
  if (!agentConfigId) {
    throw new Error("agentConfigId is required");
  }

  // Auto-calcular type desde agentConfigId
  let campaignType = type; // Mantener si viene del frontend (retrocompatibilidad)

  if (!campaignType) {
    campaignType = getCampaignTypeFromAgent(agentConfigId);
  }

  // Validar que el agentConfigId sea válido para campañas
  if (!campaignType) {
    const validIds = getValidCampaignAgentIds();
    throw new Error(
      `Invalid agent for campaigns. Agent ID must be one of: ${validIds.join(', ')}`
    );
  }

  // Solo ACTIVATION y CONVERSION pueden tener cupones
  const COUPON_ELIGIBLE_TYPES = ["ACTIVATION", "CONVERSION"];
  if (
    (couponPrefix || (Array.isArray(couponTemplateIds) && couponTemplateIds.length > 0)) &&
    !COUPON_ELIGIBLE_TYPES.includes(campaignType)
  ) {
    throw new Error(
      `Coupons are only allowed for ACTIVATION or CONVERSION campaigns. Got: ${campaignType}`
    );
  }

  const isReengagement = Array.isArray(establishmentIds) && establishmentIds.length > 0;
  const isCsvUpload = Array.isArray(csvContacts) && csvContacts.length > 0;

  if (isCsvUpload && campaignType !== "DISCOVERY") {
    throw new Error("CSV upload solo está permitido para campañas de tipo Discovery");
  }

  if (isCsvUpload && csvContacts.length > 500) {
    throw new Error("El máximo de contactos por CSV es 500");
  }

  if (isReengagement && establishmentIds.length > 500) {
    throw new Error("El máximo de establecimientos para una campaña de reenganche es 500");
  }

  if (!isReengagement && !isCsvUpload) {
    if (centerLat && centerLng && !radiusMeters) {
      throw new Error("radiusMeters is required when centerLat and centerLng are provided");
    }
    if (radiusMeters && radiusMeters < 0) {
      throw new Error("radiusMeters must be a positive number");
    }
  }

  // Guardar metadata en filters para trazabilidad
  let campaignFilters = filters;
  if (isReengagement) {
    campaignFilters = {
      ...filters,
      _reengagement: { sourceCampaignId: sourceCampaignId || null, totalPreloaded: establishmentIds.length },
    };
  } else if (isCsvUpload) {
    campaignFilters = {
      ...filters,
      _csv: {
        originalName: csvMetadata?.originalName || null,
        rowsTotal: csvMetadata?.rowsTotal || csvContacts.length,
        rowsValid: csvMetadata?.rowsValid || csvContacts.length,
        rowsRejected: csvMetadata?.rowsRejected || 0,
      },
    };
  }

  const campaign = await prisma.campaign.create({
    data: {
      name,
      description,
      type: campaignType,
      status: "DRAFT",
      // CSV y reenganche no usan coordenadas geográficas
      centerLat: isReengagement || isCsvUpload ? null : centerLat,
      centerLng: isReengagement || isCsvUpload ? null : centerLng,
      radiusMeters: isReengagement || isCsvUpload ? null : radiusMeters,
      activityCodes: isCsvUpload ? [] : (activityCodes || []),
      employeeRanges: isCsvUpload ? [] : (employeeRanges || []),
      filters: campaignFilters,
      agentConfigId,
      agentConfigName,
      offer: offer || null,
      // couponPrefix es FK a coupon_templates — enviar null si viene vacío
      couponPrefix: couponPrefix || null,
      couponTemplateIds: couponTemplateIds || [],
      createdBy,
      contactSource: isCsvUpload ? "CSV" : (contactSource || "GEO"),
      csvOriginalName: isCsvUpload ? (csvMetadata?.originalName || null) : null,
      csvRowsTotal: isCsvUpload ? (csvMetadata?.rowsTotal || csvContacts.length) : null,
      csvRowsValid: isCsvUpload ? (csvMetadata?.rowsValid || csvContacts.length) : null,
      csvRowsRejected: isCsvUpload ? (csvMetadata?.rowsRejected || 0) : null,
    },
  });

  if (isCsvUpload) {
    await assignCsvContactsToCampaign(campaign.id, csvContacts);
    logger.info("[campaignsService:createCampaign] CSV campaign created", {
      campaignId: campaign.id,
      csvRows: csvContacts.length,
      originalName: csvMetadata?.originalName || null,
    });
  } else if (isReengagement) {
    await assignContactsToCampaign(campaign.id, establishmentIds);
    logger.info('[campaignsService:createCampaign] Reengancement campaign created with preloaded contacts', {
      campaignId: campaign.id,
      sourceCampaignId: sourceCampaignId || null,
      establishmentCount: establishmentIds.length,
    });
  } else if (campaign.centerLat && campaign.centerLng && campaign.radiusMeters) {
    await assignContactsWithGeoFilter(campaign.id, {
      ...(campaign.filters && typeof campaign.filters === "object" ? campaign.filters : {}),
      activityCodes: campaign.activityCodes || [],
      employeeRanges: campaign.employeeRanges || [],
    });
  }

  logger.info(`Campaign created: ${campaign.id}`, {
    campaignId: campaign.id,
    type: campaignType,
    agentConfigId
  });
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

  // Para campañas SCHEDULED: detectar si hay cambios que requieren re-dispatch.
  // Cualquier campo que afecte el batch (zona, filtros, agente) requiere
  // cancelar el batch existente en ElevenLabs y crear uno nuevo con los datos actualizados.
  const isScheduled = existingCampaign.status === "SCHEDULED";
  const REDISPATCH_FIELDS = ["centerLat", "centerLng", "radiusMeters", "activityCodes", "employeeRanges", "filters", "agentConfigId"];

  // Solo hacer re-dispatch si el campo realmente cambió de valor.
  // Arrays y objetos se comparan por valor (JSON) para evitar re-dispatch innecesario
  // cuando el wizard envía los mismos datos sin modificaciones.
  const hasDirtyField = (field) => {
    if (data[field] === undefined) return false;
    const existing = existingCampaign[field];
    const incoming = data[field];
    if (incoming !== null && typeof incoming === "object") {
      return JSON.stringify(incoming) !== JSON.stringify(existing);
    }
    return incoming !== existing;
  };
  const needsRedispatch = isScheduled && REDISPATCH_FIELDS.some(hasDirtyField);

  let uniqueBatchIdsToCancel = [];
  if (needsRedispatch) {
    // Capturar IDs antes de que el código de reasignación los elimine
    const batchContacts = await prisma.campaignContact.findMany({
      where: { campaignId: id, providerBatchId: { not: null } },
      select: { providerBatchId: true },
    });
    uniqueBatchIdsToCancel = [...new Set(batchContacts.map((c) => c.providerBatchId).filter(Boolean))];

    if (uniqueBatchIdsToCancel.length > 0) {
      await Promise.allSettled(
        uniqueBatchIdsToCancel.map((batchId) => campaignBatchDispatcherService.cancelProviderBatch(batchId))
      );
      logger.info("[CampaignUpdate] Provider batches cancelled for SCHEDULED re-dispatch", {
        campaignId: id,
        batchCount: uniqueBatchIdsToCancel.length,
      });
    }
  }

  // Validar cupones por tipo de campaña al actualizar
  const effectiveCampaignType = type
    ? type
    : agentConfigId
      ? getCampaignTypeFromAgent(agentConfigId)
      : existingCampaign.type;

  const COUPON_ELIGIBLE_TYPES_UPDATE = ["ACTIVATION", "CONVERSION"];
  if (
    (couponPrefix || (Array.isArray(couponTemplateIds) && couponTemplateIds.length > 0)) &&
    !COUPON_ELIGIBLE_TYPES_UPDATE.includes(effectiveCampaignType)
  ) {
    throw new Error(
      `Coupons are only allowed for ACTIVATION or CONVERSION campaigns. Got: ${effectiveCampaignType}`
    );
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

  // Si requiere re-dispatch, pasar temporalmente a DRAFT para que
  // startCampaign pueda ejecutarse sin conflicto de status SCHEDULED
  const originalScheduledAt = existingCampaign.scheduledAt;
  if (needsRedispatch) {
    updateData.status = "DRAFT";
    updateData.scheduledAt = null;
  }

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

  // Re-dispatch con la misma fecha original si la campaña era SCHEDULED y hubo cambios significativos
  if (needsRedispatch) {
    const originalScheduledTimeUnix = originalScheduledAt
      ? Math.floor(new Date(originalScheduledAt).getTime() / 1000)
      : undefined;

    // Para campañas sin geo (CSV, reenganche), los contactos quedaron en SCHEDULED tras el primer
    // dispatch y el bloque de deleteMany/assign de arriba no ejecutó. Resetearlos a PENDING para
    // que startCampaign los encuentre. Para campañas geo esto no aplica: ya fueron recreados.
    if (!campaign.centerLat || !campaign.centerLng || !campaign.radiusMeters) {
      await prisma.campaignContact.updateMany({
        where: { campaignId: id, status: { in: ["SCHEDULED", "PENDING"] } },
        data: { status: "PENDING", providerBatchId: null, sentAt: null },
      });
      logger.info("[CampaignUpdate] Non-geo campaign contacts reset to PENDING for re-dispatch", {
        campaignId: id,
      });
    }

    try {
      const redispatchResult = await startCampaign(id, { scheduledTimeUnix: originalScheduledTimeUnix });
      logger.info("[CampaignUpdate] SCHEDULED campaign re-dispatched after significant update", {
        campaignId: id,
        originalScheduledAt,
        cancelledBatches: uniqueBatchIdsToCancel.length,
      });
      return redispatchResult;
    } catch (dispatchError) {
      // El update de datos fue exitoso pero el re-dispatch falló.
      // La campaña queda en DRAFT — el usuario puede reiniciarla manualmente.
      logger.error("[CampaignUpdate] Re-dispatch failed. Campaign left in DRAFT for manual restart.", {
        campaignId: id,
        error: dispatchError.message,
      });
      // Retornar la campaña en su estado actual (DRAFT) sin lanzar error
      return prisma.campaign.findUnique({ where: { id } });
    }
  }

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

/**
 * Asigna contactos importados desde un CSV a una campaña.
 * Genera un establishmentId sintético csv_<uuid> por fila para mantener
 * compatibilidad con MCPs y webhooks sin requerir un Establishment en BD geo.
 */

// Statuses que bloquean re-inclusión en nuevas campañas CSV.
// Criterio alineado con geo: solo bloqueamos cuando hay interacción real o llamada activa/pendiente.
// CALLED y PAUSED se permiten — "llamado sin respuesta" no es contacto completado,
// igual que en geo donde un establecimiento sin enrichment puede volver a seleccionarse.
// PENDING y FAILED siempre permitidos (nunca fue procesado, o falló).
const ALREADY_CONTACTED_STATUSES = [
  'SCHEDULED', 'CALLING',
  'RESPONDED', 'SENT', 'DELIVERED', 'VISITED', 'CONVERTED',
];

/**
 * Genera todas las variantes de formato de un teléfono mexicano.
 * Los contactos geo se guardan con 10 dígitos (sin +52) desde DENUE,
 * mientras el parser CSV normaliza a E.164 (+52XXXXXXXXXX).
 * Para que el dedup funcione en ambas direcciones, comparamos todas las variantes.
 */
const getPhoneVariants = (phone) => {
  if (!phone) return [];
  const variants = new Set([phone]);
  const digits = phone.replace(/\D/g, '');

  if (digits.length === 10) {
    // Número mexicano de 10 dígitos → agregar variantes con código de país
    variants.add(`+52${digits}`);
    variants.add(`52${digits}`);
  } else if (digits.length === 12 && digits.startsWith('52')) {
    // Con código de país sin + (526673882839) → agregar variantes
    const local = digits.slice(2);
    variants.add(`+52${local}`);
    variants.add(local);
  } else if (digits.length === 13 && phone.startsWith('+52')) {
    // E.164 completo (+526673882839) → agregar variantes sin código
    const local = digits.slice(2);
    variants.add(local);
    variants.add(`52${local}`);
  }
  return [...variants];
};

/**
 * Dado un array de teléfonos (canónicos del CSV, E.164), construye un Set
 * con todos los formatos posibles para el WHERE IN del dedup.
 */
const buildPhoneVariantsForQuery = (phones) => {
  const all = new Set();
  for (const phone of phones) {
    for (const variant of getPhoneVariants(phone)) {
      all.add(variant);
    }
  }
  return [...all];
};

/**
 * Dado un array de contactos encontrados en DB (con su phone tal como fue guardado),
 * construye un Set con todos los formatos normalizados para comparar contra los CSV phones.
 */
const buildContactedPhonesSet = (dbContacts) => {
  const set = new Set();
  for (const c of dbContacts) {
    if (!c.establishmentPhone) continue;
    for (const variant of getPhoneVariants(c.establishmentPhone)) {
      set.add(variant);
    }
  }
  return set;
};

const assignCsvContactsToCampaign = async (campaignId, csvRows) => {
  if (!Array.isArray(csvRows) || csvRows.length === 0) {
    throw new Error("csvRows debe ser un array no vacío");
  }

  // Deduplicación cross-campaign: excluir teléfonos que ya tienen historial activo.
  // Se generan variantes de formato (+52, sin +52, 10 dígitos) para detectar coincidencias
  // entre contactos geo (guardados sin +52 desde DENUE) y contactos CSV (E.164).
  const incomingPhones = csvRows.map(r => r.phone).filter(Boolean);
  let alreadyContactedPhones = new Set();

  if (incomingPhones.length > 0) {
    const phoneVariantsForQuery = buildPhoneVariantsForQuery(incomingPhones);
    const existingContacts = await prisma.campaignContact.findMany({
      where: {
        establishmentPhone: { in: phoneVariantsForQuery },
        status: { in: ALREADY_CONTACTED_STATUSES },
      },
      select: { establishmentPhone: true },
      distinct: ['establishmentPhone'],
    });
    // Expandir los teléfonos encontrados a todas sus variantes para comparar correctamente
    alreadyContactedPhones = buildContactedPhonesSet(existingContacts);
  }

  const deduplicatedRows = csvRows.filter(row => !alreadyContactedPhones.has(row.phone));
  const skippedCount = csvRows.length - deduplicatedRows.length;

  if (skippedCount > 0) {
    logger.info("[assignCsvContactsToCampaign] Contactos excluidos por dedup de telefono", {
      campaignId,
      skippedCount,
      totalRequested: csvRows.length,
      toCreate: deduplicatedRows.length,
    });
  }

  if (deduplicatedRows.length === 0) {
    logger.warn("[assignCsvContactsToCampaign] Todos los contactos ya existen en otras campanas — ningun contacto creado", {
      campaignId,
    });
    const totalContacts = await prisma.campaignContact.count({ where: { campaignId } });
    await prisma.campaign.update({ where: { id: campaignId }, data: { totalContacts } });
    return { count: 0, skippedCount };
  }

  const contactsToCreate = deduplicatedRows.map((row) => ({
    campaignId,
    establishmentId: `csv_${randomUUID()}`,
    establishmentName: row.name || null,
    establishmentPhone: row.phone || null,
    establishmentData: {
      source: "CSV",
      name: row.name || null,
      phone: row.phone || null,
      email: row.email || null,
      decisionMaker: row.decisionMaker || null,
      address: row.address || null,
      notes: row.notes || null,
    },
    status: "PENDING",
    sourceType: "CSV",
  }));

  const result = await prisma.campaignContact.createMany({
    data: contactsToCreate,
    skipDuplicates: true,
  });

  const totalContacts = await prisma.campaignContact.count({ where: { campaignId } });

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { totalContacts },
  });

  logger.info("[campaignsService:assignCsvContactsToCampaign] CSV contacts assigned", {
    campaignId,
    requested: csvRows.length,
    skipped: skippedCount,
    created: result.count,
    totalContacts,
  });

  return { ...result, skippedCount };
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

  const rawUniqueIds = [...new Set(establishmentIds.filter(Boolean))];
  console.log(`[assignContactsToCampaign] Unique establishment IDs received: ${rawUniqueIds.length}`);

  const campaignType = getCampaignTypeFromAgent(campaign.agentConfigId);

  // Clasifica por rango de funnel: solo entran los que están en la etapa inmediatamente anterior.
  // Excluye tanto los que aún no llegan al prerequisito como los que ya están en una etapa
  // igual o posterior (evita sobrescritura de progreso al ejecutar campañas de etapas anteriores).
  const { eligibleIds, excludedNoPrereq, excludedAdvanced } =
    await classifyEstablishmentsByStage(rawUniqueIds, campaignType);

  console.log(
    `[assignContactsToCampaign] type=${campaignType} total=${rawUniqueIds.length} ` +
    `eligible=${eligibleIds.length} excludedNoPrereq=${excludedNoPrereq} excludedAdvanced=${excludedAdvanced}`
  );

  const uniqueEstablishmentIds = eligibleIds;

  // Separar IDs sintéticos CSV (csv_<uuid>) de IDs geo reales — los CSV no existen en BD geo
  const csvOnlyIds = uniqueEstablishmentIds.filter(id => id.startsWith('csv_'));
  const geoOnlyIds = uniqueEstablishmentIds.filter(id => !id.startsWith('csv_'));

  // Para IDs CSV heredados, recuperar phone/name/data del CampaignContact de la campaña anterior
  let csvContactSnapshotById = new Map();
  if (csvOnlyIds.length > 0) {
    try {
      const previousCsvContacts = await prisma.campaignContact.findMany({
        where: {
          establishmentId: { in: csvOnlyIds },
          NOT: { campaignId },
        },
        select: {
          establishmentId: true,
          establishmentName: true,
          establishmentPhone: true,
          establishmentData: true,
        },
        distinct: ['establishmentId'],
      });
      csvContactSnapshotById = new Map(previousCsvContacts.map(c => [c.establishmentId, c]));
      logger.info('[assignContactsToCampaign] CSV contact snapshots loaded from previous campaign', {
        campaignId,
        csvIdCount: csvOnlyIds.length,
        snapshotsFound: previousCsvContacts.length,
      });
    } catch (csvLookupError) {
      logger.warn('[assignContactsToCampaign] Failed to load CSV contact snapshots', {
        campaignId,
        error: csvLookupError.message,
      });
    }
  }

  let establishments = [];

  if (geoOnlyIds.length > 0) {
    try {
      establishments = await prismaGeo.establishment.findMany({
        where: {
          id: { in: geoOnlyIds },
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
      console.log(`[assignContactsToCampaign] Establishments found in Geo DB: ${establishments.length}`);

      // Identificar establecimientos geo que no se encontraron
      const foundIds = new Set(establishments.map(e => e.id));
      const notFound = geoOnlyIds.filter(id => !foundIds.has(id));
      if (notFound.length > 0) {
        console.warn(`[assignContactsToCampaign] ${notFound.length} establishments not found in Geo DB`);
      }
    } catch (geoError) {
      logger.warn("Geo DB lookup failed while assigning campaign contacts", {
        campaignId,
        error: geoError.message,
      });
    }
  }

  const establishmentById = new Map(establishments.map((establishment) => [establishment.id, establishment]));

  // Preparar datos para inserción masiva
  const contactsToCreate = uniqueEstablishmentIds.map((establishmentId) => {
    // IDs CSV sintéticos: copiar snapshot de la campaña anterior (no existen en BD geo)
    if (establishmentId.startsWith('csv_')) {
      const snapshot = csvContactSnapshotById.get(establishmentId);
      return {
        campaignId,
        establishmentId,
        establishmentName: snapshot?.establishmentName || null,
        establishmentPhone: snapshot?.establishmentPhone || null,
        establishmentData: snapshot?.establishmentData || null,
        status: 'PENDING',
      };
    }

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

    return {
      campaignId,
      establishmentId,
      establishmentName: establishmentNameToUse,
      establishmentPhone: establishment?.phone || null,
      establishmentData,
      status: "PENDING",
    };
  });

  // Insertar todos los contactos en una sola operación
  const contacts = await prisma.campaignContact.createMany({
    data: contactsToCreate,
    skipDuplicates: true,
  });

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

  console.log(`[assignContactsWithGeoFilter] Establishments found from geoService: ${establishments.length}`);

  if (establishments.length === 0) {
    logger.info(`No establishments found in radius for campaign ${campaignId}`);
    return [];
  }

  const establishmentIds = establishments.map((e) => e.id);
  console.log(`[assignContactsWithGeoFilter] Unique establishment IDs to assign: ${establishmentIds.length}`);

  const result = await assignContactsToCampaign(campaignId, establishmentIds);
  console.log(`[assignContactsWithGeoFilter] Contacts created/updated: ${result.count}`);

  return result;
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
      contactSource: true,
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
      // Resetear contactos SCHEDULED a PENDING para que el query de abajo los encuentre.
      // Solo afecta contactos que ElevenLabs no alcanzó a procesar (siguen en SCHEDULED);
      // los que ya pasaron a CALLED/RESPONDED no se tocan.
      await prisma.campaignContact.updateMany({
        where: { campaignId, status: "SCHEDULED" },
        data: { status: "PENDING", providerBatchId: null },
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

  // Usar la voz ACTUAL del agente desde ElevenLabs (obtenida arriba en fetchAgentProfile)
  // Esto asegura que siempre usa la voz configurada en ElevenLabs UI, no voces viejas de la BD
  const agentBuilderVoiceId = resolvedAgentProfile.voiceId;
  const agentBuilderPersonalityName = resolvedAgentProfile.voiceName;

  logger.info(`[CampaignStart] Usando voz actual del agente ElevenLabs`, {
    voiceId: agentBuilderVoiceId,
    voiceName: agentBuilderPersonalityName
  });

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
    // Solo reintentar asignación geo si la campaña tiene coordenadas (no CSV)
    if (campaign.centerLat && campaign.centerLng && campaign.radiusMeters) {
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
  }

  if (contacts.length === 0) {
    const error = new Error("No hay contactos en estado PENDING para esta campaña. Todos pueden estar ya en proceso, completados o la asignación de contactos falló.");
    error.statusCode = 409;
    throw error;
  }

  const allEstablishmentIds = [...new Set(contacts.map((contact) => contact.establishmentId).filter(Boolean))];
  // IDs sintéticos csv_* no existen en BD geo — excluirlos del lookup para no generar query inútil
  const establishmentIds = allEstablishmentIds.filter((id) => !id.startsWith("csv_"));
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
          exteriorNum: true,
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

    // Prioridad 1: ElevenLabs, Prioridad 2: Agent Builder, Prioridad 3: Contact Data
    const personalityName =
      resolvedAgentProfile.voiceName ||
      agentBuilderPersonalityName ||
      resolvedAgentProfile.voiceId ||
      contactData.personality_name ||
      contactData.personalityName ||
      agentName;

    const finalVoiceName = resolvedAgentProfile.voiceName || agentBuilderPersonalityName || null;
    const finalVoiceId = resolvedAgentProfile.voiceId || agentBuilderVoiceId || null;

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

    // Buscar enrichment previo del establishment
    const enrichment = await prisma.establishmentEnrichment.findUnique({
      where: { establishmentId: contact.establishmentId },
      select: {
        establishmentData: true,
        decisionMakerName: true,
        decisionMakerEmail: true,
        enrichmentStatus: true,
        level: true,
      }
    })

    const stageData = enrichment?.establishmentData || {};

    // Gating de cupones por contact: UPGRADEPRO y REFER son post-venta exclusivamente.
    // El filtro se aplica aqui (dispatch), no al crear campaña, porque el batch puede
    // mezclar prospectos y clientes activos.
    // Nota: usamos solo level=CLIENT como señal de cliente activo — productPurchased y
    // clientStatus no se usan actualmente en el flujo y no son confiables como filtro.
    const isClient = enrichment?.level === 'CLIENT';

    const campaignTemplates = contactSpecificContext?.coupons?.templates || [];

    const eligibleTemplates = campaignTemplates.filter(t => {
      const code = t.type;
      if (code === 'UPGRADEPRO') return isClient;
      if (code === 'REFER') return isClient;
      // PLUS30, 50OFF, COMEBACK aplican a prospectos/leads (no clientes activos)
      if (['PLUS30', '50OFF', 'COMEBACK'].includes(code)) return !isClient;
      return true;
    });

    // Resolver el cupón principal para este contact: usar el principal de la campaña si
    // sigue siendo elegible, sino el primer alternativo que aplique, sino null.
    const campaignPrincipal = contactSpecificContext?.coupons?.couponType
      || campaign.couponPrefix
      || contactData.couponType
      || null;

    // Intentar match por tipo (ej. "COMEBACK") o por ID del template (UUID que guarda couponPrefix)
    const resolvedCouponType =
      eligibleTemplates.find(t => t.type === campaignPrincipal || t.id === campaignPrincipal)?.type
      || eligibleTemplates[0]?.type
      || null;

    if (campaignPrincipal && !resolvedCouponType) {
      logger.info("[CampaignStart] Cupon principal no elegible para este contact, ningun alternativo disponible", {
        contactId: contact.id,
        establishmentId: contact.establishmentId,
        campaignPrincipal,
        level: enrichment?.level,
      });
    } else if (campaignPrincipal && resolvedCouponType !== campaignPrincipal) {
      logger.info("[CampaignStart] Cupon principal sustituido por alternativo elegible para este contact", {
        contactId: contact.id,
        original: campaignPrincipal,
        resolved: resolvedCouponType,
        level: enrichment?.level,
      });
    }

    return {
      campaignContactId: contact.id,
      phone_number: phoneNumber,
      dynamic_variables: {
        campaignId,
        campaignContactId: contact.id,
        establishmentId: contact.establishmentId,
        establishment_id: contact.establishmentId,
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
        previousEmail: enrichment?.decisionMakerEmail || email || '',
        previous_email: enrichment?.decisionMakerEmail || email || '',
        // Contexto de campaña para ElevenLabs (Convertidos a string para evitar "CADENA VACÍA")
        campaignContext: contactSpecificContext ? JSON.stringify(contactSpecificContext) : "",
        // Cupones ya filtrados por elegibilidad del contact especifico
        couponsAvailable: resolvedCouponType ? "true" : "false",
        couponTypes: eligibleTemplates.map(t => t.type).join(", ") || "",
        couponType: resolvedCouponType,
        couponSendEndpoint: "/api/v1/coupons-whatsapp/generate-and-send",
        agentInstructions: contactSpecificContext?.agentInstructions || null,
        // Datos del stage
        discoveryContext: JSON.stringify(stageData.discovery || {}),
        qualificationContext: JSON.stringify(stageData.qualification || {}),
        activationContext: JSON.stringify(stageData.activation || {}),
        previousContactName: enrichment?.decisionMakerName || '',
        previousContactEmail: enrichment?.decisionMakerEmail || '',
        currentStage: enrichment?.enrichmentStatus || 'new',
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
    agentConfigId: campaign.agentConfigId,
    targetConcurrencyLimit,
    maxRecipientsPerRequest,
    scheduledTimeUnix: resolvedScheduledTimeUnix,
    callName: `campaign-${campaign.name}`,
    agentPhoneNumberId: resolvedAgentPhoneNumberId,
    agentConfigName: campaign.agentConfigName,
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

  // Enriquecer contactos con datos del establecimiento (activityCode, coordenadas, etc.)
  const enrichedContacts = await Promise.all(
    contacts.map(async (contact) => {
      try {
        const establishment = await prismaGeo.establishment.findUnique({
          where: { id: contact.establishmentId },
          select: {
            id: true,
            activityCode: true,
            latitude: true,
            longitude: true,
            phone: true,
            email: true,
            municipalityName: true,
            stateName: true,
            streetName: true,
            exteriorNum: true,
            neighborhood: true,
            employeeRange: true,
          },
        });

        // Construir dirección completa
        const address = establishment
          ? [
            establishment.streetName,
            establishment.exteriorNum,
            establishment.neighborhood,
            establishment.municipalityName,
            establishment.stateName,
          ]
            .filter(Boolean)
            .join(", ")
          : null;

        return {
          ...contact,
          activityCode: establishment?.activityCode,
          latitude: establishment?.latitude,
          longitude: establishment?.longitude,
          phone: establishment?.phone || contact.establishmentPhone,
          email: establishment?.email,
          municipalityName: establishment?.municipalityName,
          stateName: establishment?.stateName,
          address: address,
          employeeRange: establishment?.employeeRange,
        };
      } catch (error) {
        console.warn(`Failed to enrich contact ${contact.id}:`, error.message);
        return contact;
      }
    })
  );

  return {
    contacts: enrichedContacts,
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

  const agentMetrics = [];
  if (campaign.agentConfigId) {
    const totalDurationResult = await prisma.campaignContact.aggregate({
      where: { campaignId },
      _sum: { callDuration: true },
      _count: { callDuration: true },
    });

    const totalDuration = totalDurationResult._sum.callDuration || 0;
    const callsWithDurationCount = totalDurationResult._count.callDuration || 0;
    const avgDurationSeconds = callsWithDurationCount > 0 ? Math.round(totalDuration / callsWithDurationCount) : 0;
    const minutes = Math.floor(avgDurationSeconds / 60);
    const seconds = avgDurationSeconds % 60;
    const avgDurationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    agentMetrics.push({
      agentId: campaign.agentConfigId,
      agentName: campaign.agentConfigName || "Agente Desconocido",
      callsMade: totalCalled,
      responses: totalResponded,
      conversions: totalConverted,
      responseRate: responseRate.toFixed(2),
      conversionRate: conversionRate.toFixed(2),
      avgCallDuration: avgDurationStr
    });
  }

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      agentConfigId: campaign.agentConfigId,
      agentConfigName: campaign.agentConfigName,
    },
    metrics: {
      totalContacts,
      totalCalled,
      totalResponded,
      totalConverted,
      totalFailed,
      totalCoupons: campaign.couponsSent || 0, // Using the aggregated field as requested
      responseRate: responseRate.toFixed(2),
      conversionRate: conversionRate.toFixed(2),
    },
    statusBreakdown: metricsByStatus,
    conversionTimeline: conversionTimeline,
    agentMetrics: agentMetrics,
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

  // Ventana de bloqueo: no cancelar si la campaña se ejecutará en < 2 min
  // (ElevenLabs podría estar iniciando las llamadas en este momento)
  if (campaign.status === "SCHEDULED" && campaign.scheduledAt) {
    const minutesUntilExecution = (new Date(campaign.scheduledAt) - new Date()) / 1000 / 60;
    if (minutesUntilExecution < 2) {
      const error = new Error("No se puede cancelar una campaña que se ejecutará en menos de 2 minutos");
      error.statusCode = 400;
      throw error;
    }
  }

  // Obtener batch IDs únicos de contactos pendientes/programados para cancelar en ElevenLabs
  const batchContacts = await prisma.campaignContact.findMany({
    where: {
      campaignId: id,
      providerBatchId: { not: null },
      status: { in: ["SCHEDULED", "CALLING", "PENDING"] },
    },
    select: { providerBatchId: true },
  });

  const uniqueBatchIds = [...new Set(batchContacts.map((c) => c.providerBatchId).filter(Boolean))];

  if (uniqueBatchIds.length > 0) {
    // Best-effort: intentar cancelar todos. No fallar si alguno ya fue cancelado.
    const cancelResults = await Promise.allSettled(
      uniqueBatchIds.map((batchId) => campaignBatchDispatcherService.cancelProviderBatch(batchId))
    );

    const failures = cancelResults
      .map((result, i) => ({ batchId: uniqueBatchIds[i], ...result }))
      .filter((r) => r.status === "rejected");

    if (failures.length > 0) {
      logger.warn("[CampaignCancel] Some provider batches could not be cancelled", {
        campaignId: id,
        failures: failures.map((f) => ({ batchId: f.batchId, reason: f.reason?.message })),
      });
    }

    logger.info("[CampaignCancel] Provider batches processed", {
      campaignId: id,
      total: uniqueBatchIds.length,
      cancelled: cancelResults.filter((r) => r.status === "fulfilled").length,
    });
  }

  // Resetear contactos que nunca fueron alcanzados: PENDING/SCHEDULED/CALLING.
  // Al marcarlos CANCELLED (no incluido en ALREADY_CONTACTED_STATUSES) quedan
  // elegibles para futuras campañas, evitando bloqueos por campañas abortadas.
  await prisma.campaignContact.updateMany({
    where: {
      campaignId: id,
      status: { in: ["PENDING", "SCHEDULED", "CALLING"] },
    },
    data: { status: "CANCELLED" },
  });

  return prisma.campaign.update({
    where: { id },
    data: { status: "CANCELLED" },
  });
};

/**
 * Pospone una campaña SCHEDULED a una nueva fecha/hora.
 * Cancela los batches existentes en ElevenLabs y los re-envía con la nueva fecha.
 * Si el re-envío falla, la campaña queda en DRAFT para reintento manual.
 */
const rescheduleCampaign = async (campaignId, newScheduledTimeUnix) => {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) {
    const error = new Error("Campaña no encontrada");
    error.statusCode = 404;
    throw error;
  }

  if (campaign.status !== "SCHEDULED") {
    const error = new Error(
      `Solo se pueden posponer campañas SCHEDULED. Estado actual: ${campaign.status}`
    );
    error.statusCode = 400;
    throw error;
  }

  // Ventana de bloqueo: no reprogramar si faltan < 2 min para la ejecución original
  if (campaign.scheduledAt) {
    const minutesUntilExecution = (new Date(campaign.scheduledAt) - new Date()) / 1000 / 60;
    if (minutesUntilExecution < 2) {
      const error = new Error(
        "No se puede posponer una campaña que se ejecutará en menos de 2 minutos"
      );
      error.statusCode = 400;
      throw error;
    }
  }

  // Validar que la nueva fecha sea al menos 60 segundos en el futuro
  const resolvedNewTime = normalizeScheduledTimeUnix(newScheduledTimeUnix);
  if (!resolvedNewTime) {
    const error = new Error("La nueva fecha debe ser al menos 60 segundos en el futuro");
    error.statusCode = 400;
    throw error;
  }

  // Obtener batch IDs únicos para cancelar en ElevenLabs
  const batchContacts = await prisma.campaignContact.findMany({
    where: { campaignId, providerBatchId: { not: null } },
    select: { providerBatchId: true },
  });
  const uniqueBatchIds = [...new Set(batchContacts.map((c) => c.providerBatchId).filter(Boolean))];

  // Cancelar batches existentes (best-effort)
  if (uniqueBatchIds.length > 0) {
    await Promise.allSettled(
      uniqueBatchIds.map((batchId) => campaignBatchDispatcherService.cancelProviderBatch(batchId))
    );
    logger.info("[CampaignReschedule] Existing provider batches cancelled", {
      campaignId,
      batchCount: uniqueBatchIds.length,
    });
  }

  // Resetear contactos a PENDING para que startCampaign los re-despache
  await prisma.campaignContact.updateMany({
    where: { campaignId },
    data: { status: "PENDING", providerBatchId: null, sentAt: null },
  });

  // Temporalmente DRAFT para que startCampaign pueda ejecutarse sin conflicto de status
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "DRAFT", scheduledAt: null },
  });

  try {
    const result = await startCampaign(campaignId, { scheduledTimeUnix: resolvedNewTime });

    logger.info("[CampaignReschedule] Campaign rescheduled successfully", {
      campaignId,
      newScheduledAt: result.scheduledAt,
      cancelledBatches: uniqueBatchIds.length,
    });

    return result;
  } catch (dispatchError) {
    // Si el re-envío falla, la campaña queda en DRAFT para que el usuario pueda reintentar
    logger.error("[CampaignReschedule] Re-dispatch failed after cancel. Campaign left in DRAFT.", {
      campaignId,
      error: dispatchError.message,
    });

    const wrappedError = new Error(
      `Los batches anteriores fueron cancelados pero el re-envío falló: ${dispatchError.message}. La campaña quedó en DRAFT para reintento manual.`
    );
    wrappedError.statusCode = 500;
    wrappedError.campaignLeftInDraft = true;
    throw wrappedError;
  }
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

// Lee todos los contactos de la campaña origen y clasifica cuáles son elegibles
// para el siguiente stage según enrichmentStatus. Read-only — no crea nada.
const previewContinuation = async (sourceCampaignId) => {
  const source = await prisma.campaign.findUnique({
    where: { id: sourceCampaignId },
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      updatedAt: true,
      centerLat: true,
      centerLng: true,
      radiusMeters: true,
      activityCodes: true,
      employeeRanges: true,
      filters: true,
      description: true,
      contactSource: true,
      csvOriginalName: true,
    },
  });

  if (!source) {
    const err = new Error('Campaña origen no encontrada');
    err.statusCode = 404;
    throw err;
  }

  if (source.status !== 'COMPLETED') {
    const err = new Error(`Solo se pueden continuar campañas completadas. Estado actual: ${source.status}`);
    err.statusCode = 400;
    throw err;
  }

  const nextType = NEXT_STAGE[source.type];
  if (!nextType) {
    const err = new Error('Las campañas de Conversion son la etapa final del funnel y no pueden continuarse');
    err.statusCode = 400;
    throw err;
  }

  const contacts = await prisma.campaignContact.findMany({
    where: { campaignId: sourceCampaignId },
    select: { establishmentId: true },
  });

  const establishmentIds = contacts.map(c => c.establishmentId).filter(Boolean);
  const totalSourceContacts = establishmentIds.length;

  const { eligibleIds, excludedNoPrereq, excludedAdvanced } =
    await classifyEstablishmentsByStage(establishmentIds, nextType);

  const msElapsed = Date.now() - new Date(source.updatedAt).getTime();
  const daysSinceCompletion = msElapsed / (1000 * 60 * 60 * 24);

  const capitalize = (s) => s.charAt(0) + s.slice(1).toLowerCase();

  return {
    sourceCampaignId,
    sourceCampaignName: source.name,
    sourceType: source.type,
    nextType,
    // Quitar sufijo de stage previo para evitar acumulación: "uwu2 - Qualification" → "uwu2 - Activation"
    suggestedName: `${source.name.replace(/\s*-\s*(Discovery|Qualification|Activation|Conversion)\s*$/i, '')} - ${capitalize(nextType)}`,
    eligibleCount: eligibleIds.length,
    eligibleIds,
    totalSourceContacts,
    excludedNoPrereq,
    excludedAdvanced,
    daysSinceCompletion,
    requiresCoupon: COUPON_REQUIRED_TYPES.includes(nextType),
    sourceFilters: {
      centerLat: source.centerLat,
      centerLng: source.centerLng,
      radiusMeters: source.radiusMeters,
      activityCodes: source.activityCodes,
      employeeRanges: source.employeeRanges,
      filters: source.filters,
      description: source.description,
      contactSource: source.contactSource,
      csvOriginalName: source.csvOriginalName,
    },
  };
};

// Crea la campaña del siguiente stage heredando filtros y contactos elegibles de la origen.
// Para ACTIVATION/CONVERSION requiere couponPrefix.
const continueCampaign = async (sourceCampaignId, opts = {}) => {
  const { name, scheduledAt, couponPrefix, couponTemplateIds, offer, createdBy } = opts;

  const preview = await previewContinuation(sourceCampaignId);

  if (preview.requiresCoupon && !couponPrefix) {
    const err = new Error(`Las campañas de ${preview.nextType} requieren un cupón principal. Por favor selecciona un cupón antes de continuar.`);
    err.statusCode = 400;
    throw err;
  }

  if (preview.eligibleIds.length === 0) {
    const err = new Error(`No hay restaurantes elegibles para continuar a ${preview.nextType}. Ninguno completó la etapa de ${preview.sourceType}.`);
    err.statusCode = 400;
    throw err;
  }

  const { sourceFilters } = preview;

  const isCsvSourceCampaign = sourceFilters.contactSource === 'CSV';

  let campaign = await createCampaign({
    name: name || preview.suggestedName,
    description: sourceFilters.description,
    centerLat: sourceFilters.centerLat,
    centerLng: sourceFilters.centerLng,
    radiusMeters: sourceFilters.radiusMeters,
    activityCodes: sourceFilters.activityCodes,
    employeeRanges: sourceFilters.employeeRanges,
    filters: sourceFilters.filters,
    agentConfigId: CAMPAIGN_TYPE_TO_AGENT[preview.nextType],
    agentConfigName: CAMPAIGN_TYPE_TO_AGENT_NAME[preview.nextType],
    offer: offer || null,
    couponPrefix: couponPrefix || null,
    couponTemplateIds: couponTemplateIds || [],
    createdBy,
    establishmentIds: preview.eligibleIds,
    sourceCampaignId,
    // Propagar source CSV para que CampaignDetails muestre el panel correcto
    contactSource: isCsvSourceCampaign ? 'CSV' : undefined,
  });

  // createCampaign nula las coordenadas cuando recibe establishmentIds (lógica de reenganche).
  // Para continuación las restauramos para que el mapa y los detalles muestren el área original.
  // Las campañas CSV no tienen coordenadas — no restaurar en ese caso.
  if (!isCsvSourceCampaign && sourceFilters.centerLat && sourceFilters.centerLng && sourceFilters.radiusMeters) {
    campaign = await prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        centerLat: sourceFilters.centerLat,
        centerLng: sourceFilters.centerLng,
        radiusMeters: sourceFilters.radiusMeters,
      },
    });
  }

  // Si el usuario eligió programar para más tarde, marcar como SCHEDULED
  if (scheduledAt) {
    const scheduledDate = new Date(scheduledAt);
    if (!isNaN(scheduledDate.getTime()) && scheduledDate > new Date()) {
      campaign = await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: 'SCHEDULED', scheduledAt: scheduledDate },
      });
    }
  }

  logger.info('[campaignsService:continueCampaign] Continuation campaign created', {
    sourceCampaignId,
    newCampaignId: campaign.id,
    nextType: preview.nextType,
    eligibleCount: preview.eligibleIds.length,
    scheduled: !!scheduledAt,
  });

  return campaign;
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
  rescheduleCampaign,
  retryCampaignContacts,
  getCampaignTypeFromAgent,
  getValidCampaignAgentIds,
  getReengagementCandidates,
  classifyEstablishmentsByStage,
  previewContinuation,
  continueCampaign,
  STAGE_PREREQUISITES,
  PRIOR_STAGE_DISPLAY,
  CAMPAIGN_RANK,
  STAGE_RANK,
  NEXT_STAGE,
  // Helpers de dedup por teléfono reutilizados en el controller
  buildPhoneVariantsForQuery,
  buildContactedPhonesSet,
  ALREADY_CONTACTED_STATUSES,
};
