const axios = require("axios");
const prisma = require("../config/database");
const logger = require("../config/logger");

const ELEVENLABS_BATCH_SUBMIT_URL =
  process.env.ELEVENLABS_BATCH_SUBMIT_URL || "https://api.elevenlabs.io/v1/convai/batch-calling/submit";

const DEFAULT_TIMEOUT_MS = parseInt(process.env.ELEVENLABS_BATCH_TIMEOUT_MS || "15000", 10);
const DEFAULT_MAX_RECIPIENTS = parseInt(
  process.env.ELEVENLABS_BATCH_MAX_RECIPIENTS_PER_REQUEST || "100",
  10
);
const DEFAULT_TARGET_CONCURRENCY = parseInt(
  process.env.ELEVENLABS_BATCH_TARGET_CONCURRENCY || "10",
  10
);

const ensurePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
};

const chunkArray = (array, size) => {
  if (!Array.isArray(array) || array.length === 0) {
    return [];
  }

  const chunks = [];
  for (let index = 0; index < array.length; index += size) {
    chunks.push(array.slice(index, index + size));
  }

  return chunks;
};

const normalizePhoneNumber = (value) => {
  if (!value || typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  if (!digits) {
    return null;
  }

  if (hasPlus) {
    return `+${digits}`;
  }

  if (digits.length === 10) {
    return `+52${digits}`;
  }

  if (digits.length === 12 && digits.startsWith("52")) {
    return `+${digits}`;
  }

  if (digits.length >= 11 && digits.length <= 15) {
    return `+${digits}`;
  }

  return null;
};

const extractProviderBatchId = (responseData = {}) => {
  return (
    responseData.batch_id ||
    responseData.batchId ||
    responseData.id ||
    responseData.data?.batch_id ||
    responseData.data?.batchId ||
    responseData.data?.id ||
    null
  );
};

const toReadableErrorDetail = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const pickFirstNonEmptyString = (...values) => {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }

  return null;
};

const removeDuplicateAliases = (dynamicVariables = {}) => {
  const cleaned = { ...dynamicVariables };
  const keepBothAliases = new Set(["establishmentId"]);

  const aliasPairs = [
    ["establishmentName", "establishment_name"],
    ["decisionMakerName", "decision_maker_name"],
    ["agentName", "agent_name"],
    ["companyName", "company_name"],
    ["contactName", "contact_name"],
    ["leadName", "lead_name"],
    ["personalityName", "personality_name"],
    ["sessionId", "session_id"],
    ["establishmentId", "establishment_id"],
    ["voiceName", "voice_name"],
    ["voiceId", "voice_id"],
  ];

  for (const [camelKey, snakeKey] of aliasPairs) {
    const hasCamel = cleaned[camelKey] !== undefined && cleaned[camelKey] !== null && cleaned[camelKey] !== "";
    const hasSnake = cleaned[snakeKey] !== undefined && cleaned[snakeKey] !== null && cleaned[snakeKey] !== "";

    if (keepBothAliases.has(camelKey)) {
      continue;
    }

    if (hasCamel && hasSnake) {
      delete cleaned[camelKey];
    }
  }

  return cleaned;
};

const ensureRequiredDynamicVariables = (dynamicVariables = {}, options = {}) => {
  const { campaignContactId, campaignId, establishmentId: establishmentIdFromOptions } = options;

  const establishmentName =
    pickFirstNonEmptyString(
      dynamicVariables.establishmentName,
      dynamicVariables.establishment_name,
      dynamicVariables.businessName,
      dynamicVariables.business_name,
      dynamicVariables.companyName,
      dynamicVariables.company_name
    ) || "Establecimiento";

  const decisionMakerName =
    pickFirstNonEmptyString(
      dynamicVariables.decisionMakerName,
      dynamicVariables.decision_maker_name,
      dynamicVariables.prospectName,
      dynamicVariables.prospect_name,
      dynamicVariables.contactName,
      dynamicVariables.contact_name,
      dynamicVariables.leadName,
      dynamicVariables.lead_name
    ) || "Prospecto";

  const agentName =
    pickFirstNonEmptyString(
      dynamicVariables.agentName,
      dynamicVariables.agent_name
    ) || "Asesor EasyOrder";

  const personalityName =
    pickFirstNonEmptyString(
      dynamicVariables.personality_name,
      dynamicVariables.personalityName,
      dynamicVariables.voice_name,
      dynamicVariables.voiceName,
      dynamicVariables.voice_id,
      dynamicVariables.voiceId,
      dynamicVariables.agent_name,
      dynamicVariables.agentName,
      agentName
    ) || "Asesor EasyOrder";

  const sessionId =
    pickFirstNonEmptyString(
      dynamicVariables.session_id,
      dynamicVariables.sessionId,
      campaignContactId,
      dynamicVariables.campaignContactId
    ) || `${campaignId || "campaign"}-session`;

  const establishmentId =
    pickFirstNonEmptyString(
      dynamicVariables.establishmentId,
      dynamicVariables.establishment_id,
      establishmentIdFromOptions,
      campaignContactId,
      dynamicVariables.campaignContactId
    ) || `${campaignId || "campaign"}-establishment`;

  const normalized = {
    ...dynamicVariables,
    establishmentName,
    establishment_name: establishmentName,
    businessName: dynamicVariables.businessName || establishmentName,
    companyName: dynamicVariables.companyName || establishmentName,
    company_name: dynamicVariables.company_name || establishmentName,
    decisionMakerName,
    decision_maker_name: decisionMakerName,
    prospectName: dynamicVariables.prospectName || decisionMakerName,
    contactName: dynamicVariables.contactName || decisionMakerName,
    contact_name: dynamicVariables.contact_name || decisionMakerName,
    leadName: dynamicVariables.leadName || decisionMakerName,
    lead_name: dynamicVariables.lead_name || decisionMakerName,
    agentName,
    agent_name: agentName,
    personality_name: personalityName,
    personalityName: personalityName,
    session_id: sessionId,
    sessionId: sessionId,
    establishmentId,
    establishment_id: establishmentId,
  };

  return removeDuplicateAliases(normalized);
};

const sanitizeRecipient = (recipient = {}, campaignId) => {
  const phoneSource = recipient.phone_number || recipient.phoneNumber || recipient.phone;
  const normalizedPhone = normalizePhoneNumber(phoneSource);

  const rawDynamicVariables = {
    ...(recipient.dynamic_variables || recipient.dynamicVariables || {}),
    campaignId,
  };

  const dynamicVariables = Object.entries(rawDynamicVariables).reduce((accumulator, [key, value]) => {
    if (value === null || value === undefined) {
      return accumulator;
    }

    if (["string", "number", "boolean"].includes(typeof value)) {
      accumulator[key] = value;
      return accumulator;
    }

    accumulator[key] = String(value);
    return accumulator;
  }, {});

  const campaignContactId =
    dynamicVariables.campaignContactId ||
    recipient.campaignContactId ||
    recipient.contactId ||
    null;

  const establishmentId =
    dynamicVariables.establishmentId ||
    dynamicVariables.establishment_id ||
    recipient.establishmentId ||
    recipient.establishment_id ||
    null;

  const enforcedDynamicVariables = ensureRequiredDynamicVariables(dynamicVariables, {
    campaignContactId,
    campaignId,
    establishmentId,
  });

  delete enforcedDynamicVariables.couponCode;

  if (campaignContactId) {
    enforcedDynamicVariables.campaignContactId = campaignContactId;
  }

  return {
    phoneNumber: normalizedPhone,
    dynamicVariables: enforcedDynamicVariables,
    campaignContactId,
  };
};

const buildRecipientsPayload = (recipients = [], campaignId) => {
  const validRecipients = [];
  const invalidRecipients = [];

  for (const recipient of recipients) {
    const sanitized = sanitizeRecipient(recipient, campaignId);
    if (!sanitized.phoneNumber || !sanitized.campaignContactId) {
      invalidRecipients.push({
        recipient,
        reason: !sanitized.phoneNumber
          ? "Invalid or missing phone number"
          : "Missing campaignContactId",
      });
      continue;
    }

    validRecipients.push(sanitized);
  }

  return { validRecipients, invalidRecipients };
};

const persistBatchDispatchResult = async ({
  campaignId,
  providerBatchId,
  rawProviderResponse,
  recipients,
}) => {
  const campaignContactIds = recipients
    .map((recipient) => recipient.campaignContactId)
    .filter(Boolean);

  if (campaignContactIds.length === 0) {
    logger.warn("No campaign contacts to persist batch dispatch result", {
      campaignId,
      providerBatchId,
    });
    return;
  }

  const contacts = await prisma.campaignContact.findMany({
    where: {
      id: { in: campaignContactIds },
      campaignId,
    },
    select: {
      id: true,
      establishmentData: true,
    },
  });

  const submittedAt = new Date().toISOString();

  await prisma.$transaction(
    contacts.map((contact) => {
      const previousEstablishmentData =
        contact.establishmentData && typeof contact.establishmentData === "object"
          ? contact.establishmentData
          : {};

      const establishmentData = {
        ...previousEstablishmentData,
        batchDispatch: {
          provider: "elevenlabs",
          providerBatchId,
          submittedAt,
          rawProviderResponse,
        },
      };

      return prisma.campaignContact.update({
        where: { id: contact.id },
        data: {
          status: "CALLING",
          providerBatchId,
          sentAt: new Date(),
          establishmentData,
        },
      });
    })
  );
};

const submitChunkToProvider = async ({
  campaignId,
  chunk,
  agentId,
  targetConcurrencyLimit,
  scheduledTimeUnix,
  callName,
  agentPhoneNumberId,
}) => {
  const payload = {
    call_name: callName || `campaign-${campaignId}-${Date.now()}`,
    agent_id: agentId,
    target_concurrency_limit: targetConcurrencyLimit,
    recipients: chunk.map((recipient) => {
      const voiceId = recipient.dynamicVariables?.voice_id || recipient.dynamicVariables?.voiceId;

      const recipientData = {
        phone_number: recipient.phoneNumber,
        dynamic_variables: recipient.dynamicVariables,
        conversation_initiation_client_data: {
          dynamic_variables: recipient.dynamicVariables,
        },
      };

      // Si hay un voice_id específico, incluirlo en múltiples lugares (Shotgun approach) 
      // para asegurar que ElevenLabs lo tome independientemente de la versión de la API
      if (voiceId) {
        // 1. Root level
        recipientData.voice_id = voiceId;

        // 2. Inside conversation_initiation_client_data (SDR Microservice style)
        recipientData.conversation_initiation_client_data.voice_id = voiceId;
        recipientData.conversation_initiation_client_data.conversation_config_override = {
          tts: {
            voice_id: voiceId
          }
        };

        // 3. Outside conversation_initiation_client_data (Batch API root level style)
        recipientData.conversation_config_override = {
          tts: {
            voice_id: voiceId
          }
        };
      }

      return recipientData;
    }),
  };

  if (scheduledTimeUnix) {
    payload.scheduled_time_unix = scheduledTimeUnix;
  }

  if (agentPhoneNumberId) {
    payload.agent_phone_number_id = agentPhoneNumberId;
  }

  try {
    logger.info("[BatchDispatcher] About to submit batch to ElevenLabs", {
      campaignId,
      agentId,
      recipientCount: chunk.length,
      callName: payload.call_name,
      agentPhoneNumberId,
      firstRecipient: payload.recipients[0] ? {
        phoneNumber: payload.recipients[0].phone_number,
        dynamicVariables: payload.recipients[0].dynamic_variables,
        voiceId: payload.recipients[0].voice_id,
        configOverride: payload.recipients[0].conversation_config_override,
        clientData: payload.recipients[0].conversation_initiation_client_data,
      } : null,
    });

    const response = await axios.post(ELEVENLABS_BATCH_SUBMIT_URL, payload, {
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
      },
      timeout: DEFAULT_TIMEOUT_MS,
    });

    logger.info("[BatchDispatcher] Batch submitted successfully", {
      campaignId,
      status: response.status,
      batchId: extractProviderBatchId(response.data),
      responseKeys: Object.keys(response.data),
    });

    const providerBatchId = extractProviderBatchId(response.data);
    if (!providerBatchId) {
      throw new Error("Provider response does not contain batch id");
    }

    await persistBatchDispatchResult({
      campaignId,
      providerBatchId,
      rawProviderResponse: response.data,
      recipients: chunk,
    });

    return {
      success: true,
      providerBatchId,
      contactCount: chunk.length,
      rawResponse: response.data,
    };
  } catch (error) {
    const status = error.response?.status;
    const isTimeout = error.code === "ECONNABORTED";

    const errorPayload = {
      campaignId,
      status,
      isTimeout,
      message: error.message,
      providerResponse: error.response?.data,
    };

    if (status === 422) {
      logger.error("Batch dispatch rejected by provider (422)", errorPayload);
    } else if (status === 429) {
      logger.error("Batch dispatch rate limited by provider (429)", errorPayload);
    } else if (isTimeout) {
      logger.error("Batch dispatch timeout", errorPayload);
    } else {
      logger.error("Batch dispatch failed", errorPayload);
    }

    const providerDetail =
      error.response?.data?.detail ??
      error.response?.data?.message ??
      error.response?.data?.error ??
      error.response?.data ??
      null;

    const providerDetailText = toReadableErrorDetail(providerDetail);

    const dispatchError = new Error(
      providerDetailText
        ? `Batch dispatch failed (${status || error.code || "UNKNOWN"}): ${providerDetailText}`
        : `Batch dispatch failed (${status || error.code || "UNKNOWN"})`
    );
    dispatchError.statusCode = status || 500;
    dispatchError.details = error.response?.data || { message: error.message };
    throw dispatchError;
  }
};

const submitCampaignBatch = async ({
  campaignId,
  recipients,
  agentId,
  targetConcurrencyLimit = DEFAULT_TARGET_CONCURRENCY,
  maxRecipientsPerRequest = DEFAULT_MAX_RECIPIENTS,
  scheduledTimeUnix,
  callName,
  agentPhoneNumberId,
}) => {
  if (!campaignId) {
    throw new Error("campaignId is required");
  }

  if (!agentId) {
    throw new Error("agentId is required");
  }

  if (!process.env.ELEVENLABS_API_KEY) {
    throw new Error("ELEVENLABS_API_KEY is required");
  }

  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new Error("recipients must be a non-empty array");
  }

  const { validRecipients, invalidRecipients } = buildRecipientsPayload(recipients, campaignId);

  if (validRecipients.length === 0) {
    throw new Error("No valid recipients found for batch dispatch");
  }

  const safeMaxRecipientsPerRequest = ensurePositiveInt(maxRecipientsPerRequest, DEFAULT_MAX_RECIPIENTS);
  const safeTargetConcurrencyLimit = ensurePositiveInt(
    targetConcurrencyLimit,
    DEFAULT_TARGET_CONCURRENCY
  );

  const chunks = chunkArray(validRecipients, safeMaxRecipientsPerRequest);
  const chunkResults = [];

  logger.info("Submitting campaign batch", {
    campaignId,
    totalRecipients: recipients.length,
    validRecipients: validRecipients.length,
    invalidRecipients: invalidRecipients.length,
    chunkCount: chunks.length,
    targetConcurrencyLimit: safeTargetConcurrencyLimit,
  });

  for (const [index, chunk] of chunks.entries()) {
    logger.info("Submitting campaign batch chunk", {
      campaignId,
      chunkIndex: index + 1,
      chunkSize: chunk.length,
      chunkCount: chunks.length,
    });

    // Check if campaign was paused or cancelled mid-batch
    const currentCampaign = await prisma.campaign.findUnique({ 
      where: { id: campaignId },
      select: { status: true }
    });

    if (currentCampaign && (currentCampaign.status === "PAUSED" || currentCampaign.status === "CANCELLED")) {
      logger.info("[BatchDispatcher] Campaign was paused or cancelled. Stopping chunk dispatch.", {
        campaignId,
        status: currentCampaign.status,
        chunksSent: index,
        remainingChunks: chunks.length - index,
      });
      break;
    }

    const chunkResult = await submitChunkToProvider({
      campaignId,
      chunk,
      agentId,
      targetConcurrencyLimit: safeTargetConcurrencyLimit,
      scheduledTimeUnix,
      callName: callName ? `${callName}-chunk-${index + 1}` : undefined,
      agentPhoneNumberId,
    });

    chunkResults.push(chunkResult);
  }

  return {
    success: true,
    campaignId,
    totalRecipients: recipients.length,
    dispatchedRecipients: validRecipients.length,
    skippedRecipients: invalidRecipients.length,
    invalidRecipients,
    chunkResults,
    providerBatchIds: chunkResults.map((result) => result.providerBatchId),
  };
};

const getCampaignBatchDispatchStats = async (campaignId) => {
  if (!campaignId) {
    throw new Error("campaignId is required");
  }

  const [
    totalContacts,
    dispatchedContacts,
    pendingContacts,
    batchGroups,
    statusBreakdown,
  ] = await Promise.all([
    prisma.campaignContact.count({ where: { campaignId } }),
    prisma.campaignContact.count({
      where: {
        campaignId,
        providerBatchId: { not: null },
      },
    }),
    prisma.campaignContact.count({
      where: {
        campaignId,
        providerBatchId: null,
      },
    }),
    prisma.campaignContact.groupBy({
      by: ["providerBatchId"],
      where: {
        campaignId,
        providerBatchId: { not: null },
      },
      _count: { _all: true },
    }),
    prisma.campaignContact.groupBy({
      by: ["status"],
      where: { campaignId },
      _count: { _all: true },
    }),
  ]);

  return {
    campaignId,
    totalContacts,
    dispatchedContacts,
    pendingContacts,
    dispatchRate: totalContacts > 0 ? ((dispatchedContacts / totalContacts) * 100).toFixed(2) : "0.00",
    totalBatches: batchGroups.length,
    batches: batchGroups.map((group) => ({
      providerBatchId: group.providerBatchId,
      contacts: group._count._all,
    })),
    statusBreakdown: statusBreakdown.reduce((accumulator, entry) => {
      accumulator[entry.status] = entry._count._all;
      return accumulator;
    }, {}),
  };
};

module.exports = {
  submitCampaignBatch,
  getCampaignBatchDispatchStats,
};
