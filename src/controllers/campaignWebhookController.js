const crypto = require("crypto");
const prisma = require("../config/database");
const logger = require("../config/logger");

const SUPPORTED_EVENT_TYPES = new Set([
    "post_call_transcription",
    "post_call_report",
    "call_ended",
    "conversation_ended",
    "conversation.ended",
    "call_initiation_failure",
]);

const isSupportedCampaignWebhookEvent = (eventType) => {
    if (!eventType || typeof eventType !== "string") {
        return false;
    }

    if (SUPPORTED_EVENT_TYPES.has(eventType)) {
        return true;
    }

    const normalized = eventType.toLowerCase();
    return (
        normalized.includes("post_call") ||
        normalized.includes("ended") ||
        normalized.includes("failed") ||
        normalized.includes("rejected") ||
        normalized.includes("missed") ||
        normalized.includes("no_answer") ||
        normalized.includes("unanswered") ||
        normalized.includes("error")
    );
};

const parseSignatureHeader = (signatureHeader = "") => {
    const parts = signatureHeader
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);

    const parsed = {};
    for (const part of parts) {
        const [key, value] = part.split("=");
        if (key && value) {
            parsed[key] = value;
        }
    }

    return {
        timestamp: parsed.t,
        signatureV0: parsed.v0,
    };
};

const computeHmacHex = (secret, value) => {
    return crypto.createHmac("sha256", secret).update(value).digest("hex");
};

const isSafeEqualHex = (left, right) => {
    if (!left || !right || left.length !== right.length) {
        return false;
    }

    return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
};

const verifyElevenLabsSignature = ({ signatureHeader, rawBody, secret }) => {
    if (!secret) {
        return { valid: false, reason: "Missing ELEVENLABS_WEBHOOK_SECRET" };
    }

    const { timestamp, signatureV0 } = parseSignatureHeader(signatureHeader);
    if (!timestamp || !signatureV0) {
        return { valid: false, reason: "Invalid elevenlabs-signature header" };
    }

    const bodyString =
        typeof rawBody === "string"
            ? rawBody
            : rawBody && typeof rawBody === "object"
                ? JSON.stringify(rawBody)
                : "";
    const expectedWithTimestamp = computeHmacHex(secret, `${timestamp}.${bodyString}`);
    const expectedBodyOnly = computeHmacHex(secret, bodyString);

    const valid =
        isSafeEqualHex(expectedWithTimestamp, signatureV0) || isSafeEqualHex(expectedBodyOnly, signatureV0);

    if (!valid) {
        return { valid: false, reason: "Signature mismatch" };
    }

    return { valid: true };
};

const getWebhookSecrets = () => {
    const fromSingle = (process.env.ELEVENLABS_WEBHOOK_SECRET || "").trim();
    const fromList = (process.env.ELEVENLABS_WEBHOOK_SECRETS || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);

    return Array.from(new Set([fromSingle, ...fromList].filter(Boolean)));
};

const isTruthyEnv = (value) => {
    if (typeof value !== "string") {
        return false;
    }

    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};

const firstNonEmpty = (...values) => {
    for (const value of values) {
        if (value !== null && value !== undefined && value !== "") {
            return value;
        }
    }
    return null;
};

const parseDuration = (...values) => {
    for (const value of values) {
        if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
            return value;
        }

        if (typeof value === "string") {
            const parsed = Number.parseInt(value, 10);
            if (Number.isFinite(parsed) && parsed >= 0) {
                return parsed;
            }
        }
    }

    return null;
};

const parseBoolean = (value) => {
    if (value === true || value === false) {
        return value;
    }

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true") {
            return true;
        }
        if (normalized === "false") {
            return false;
        }
    }

    return null;
};

const hasMeaningfulFailureReason = (reason) => {
    if (typeof reason !== "string") {
        return false;
    }

    const normalized = reason.trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return normalized !== "summary couldn't be generated for this call.";
};

const HARD_FAILURE_KEYWORDS = [
    "invalid number",
    "number not found",
    "blocked",
    "blacklist",
    "forbidden",
    "unauthorized",
    "failed to connect",
    "network error",
    "carrier error",
    "not reachable",
    "numero invalido",
    "número inválido",
    "numero no existe",
    "número no existe",
    "bloqueado",
    "bloqueada",
    "spam",
];

const NO_ANSWER_KEYWORDS = [
    "reject",
    "rejected",
    "declined",
    "decline",
    "no answer",
    "did not answer",
    "unanswered",
    "busy",
    "voicemail",
    "voice mail",
    "answering machine",
    "hung up",
    "hang up",
    "disconnected",
    "disconnect",
    "dropped",
    "rechaz",
    "rechazo",
    "rechazada",
    "rechazado",
    "no contest",
    "no contesta",
    "ocupado",
    "buzon",
    "buzón",
    "colgo",
    "colgó",
    "corto",
    "cortó",
    "contestador",
];

const normalizeText = (value) => {
    if (typeof value !== "string") {
        return "";
    }

    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
};

const hasKeywordEvidence = ({ failureReason, transcriptSummary, keywords }) => {
    const mergedText = [failureReason, transcriptSummary]
        .map(normalizeText)
        .filter(Boolean)
        .join(" ");

    if (!mergedText) {
        return false;
    }

    return keywords.some((keyword) => mergedText.includes(normalizeText(keyword)));
};

const hasHardFailureEvidence = ({ failureReason, transcriptSummary }) => {
    return hasKeywordEvidence({ failureReason, transcriptSummary, keywords: HARD_FAILURE_KEYWORDS });
};

const hasNoAnswerEvidence = ({ failureReason, transcriptSummary }) => {
    return hasKeywordEvidence({ failureReason, transcriptSummary, keywords: NO_ANSWER_KEYWORDS });
};

const hasVoicemailEvidence = ({ transcriptSummary, failureReason }) => {
    const voicemailKeywords = ["voicemail", "voice mail", "buzon", "buzón", "answering machine", "beep", "re-record", "interrupted by", "contestador"];
    return hasKeywordEvidence({ failureReason, transcriptSummary, keywords: voicemailKeywords });
};

const hasConversationEvidence = ({ callDuration, transcriptSummary, failureReason }) => {
    // Si detecta buzón, no es conversación real
    if (hasVoicemailEvidence({ transcriptSummary, failureReason })) {
        return false;
    }

    if (typeof callDuration === "number" && Number.isFinite(callDuration) && callDuration > 0) {
        return true;
    }

    if (typeof transcriptSummary === "string" && transcriptSummary.trim().length > 0) {
        const normalized = transcriptSummary.trim().toLowerCase();
        return normalized !== "summary couldn't be generated for this call.";
    }

    return false;
};

const resolveFinalContactStatus = ({ callSuccessful, failureReason, callDuration, transcriptSummary }) => {
    if (hasHardFailureEvidence({ failureReason, transcriptSummary })) {
        return "FAILED";
    }

    // Conversación real es RESPONDED, independiente de callSuccessful
    if (hasConversationEvidence({ callDuration, transcriptSummary, failureReason })) {
        return "RESPONDED";
    }

    if (callSuccessful === true) {
        return "CALLED";
    }

    if (hasNoAnswerEvidence({ failureReason, transcriptSummary })) {
        return "CALLED";
    }

    if (callSuccessful === false) {
        return "FAILED";
    }

    if (hasMeaningfulFailureReason(failureReason)) {
        return "CALLED";
    }

    return "CALLED";
};

const normalizePhoneForLookup = (value) => {
    if (typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    const digits = trimmed.replace(/\D/g, "");
    if (!digits) {
        return null;
    }

    // Retornamos los últimos 10 dígitos para hacer match con el formato local,
    // ignorando el código de país (ej. +52) que agrega ElevenLabs
    return digits.length >= 10 ? digits.slice(-10) : digits;
};

const extractWebhookData = (payload = {}) => {
    const data = payload.data && typeof payload.data === "object" ? payload.data : {};
    const metadata = data.metadata && typeof data.metadata === "object" ? data.metadata : {};
    const conversationInitData =
        data.conversation_initiation_client_data && typeof data.conversation_initiation_client_data === "object"
            ? data.conversation_initiation_client_data
            : {};

    const customLlmData =
        (data.custom_llm_data && typeof data.custom_llm_data === "object" && data.custom_llm_data) ||
        (conversationInitData.custom_llm_data &&
            typeof conversationInitData.custom_llm_data === "object" &&
            conversationInitData.custom_llm_data) ||
        (conversationInitData.dynamic_variables &&
            typeof conversationInitData.dynamic_variables === "object" &&
            conversationInitData.dynamic_variables) ||
        (metadata.dynamic_variables && typeof metadata.dynamic_variables === "object" && metadata.dynamic_variables) ||
        (data.dynamic_variables && typeof data.dynamic_variables === "object" && data.dynamic_variables) ||
        {};

    const conversationId = firstNonEmpty(
        data.conversation_id,
        data.conversationId,
        data.conversation?.id,
        metadata.conversation_id,
        metadata.conversationId,
        payload.conversation_id,
        payload.conversationId,
    );

    const campaignContactId = firstNonEmpty(
        customLlmData.campaignContactId,
        customLlmData.campaign_contact_id,
        customLlmData.contactId,
        customLlmData.contact_id,
        data.campaignContactId,
        data.campaign_contact_id,
        metadata.campaignContactId,
        metadata.campaign_contact_id,
        metadata.campaign_contact_id,
    );

    const campaignId = firstNonEmpty(
        customLlmData.campaignId,
        customLlmData.campaign_id,
        data.campaignId,
        data.campaign_id,
        metadata.campaignId,
        metadata.campaign_id,
    );

    const couponGenerated = firstNonEmpty(
        customLlmData.couponGenerated,
        customLlmData.coupon_generated,
        data.couponGenerated,
        data.coupon_generated,
    );

    const phoneNumber = firstNonEmpty(
        data.phone_number,
        data.phoneNumber,
        data.to_number,
        data.toNumber,
        data.recipient?.phone_number,
        data.recipient?.phoneNumber,
        metadata.phone_number,
        metadata.phoneNumber,
        customLlmData.phone_number,
        customLlmData.phoneNumber,
    );

    const providerBatchId = firstNonEmpty(
        data.batch_id,
        data.batchId,
        metadata.batch_id,
        metadata.batchId,
        customLlmData.providerBatchId,
        customLlmData.provider_batch_id,
    );

    const parsedCallSuccessful = parseBoolean(
        firstNonEmpty(
            data.analysis?.call_successful,
            data.analysis?.is_successful,
            data.analysis?.success,
            data.call_successful,
            data.success,
            metadata.call_successful,
            metadata.success,
        ),
    );

    return {
        eventType: payload.type || payload.event_type || data.type || null,
        campaignId,
        campaignContactId,
        conversationId,
        phoneNumber,
        providerBatchId,
        callSuccessful: parsedCallSuccessful,
        transcriptSummary: firstNonEmpty(
            data.analysis?.transcript_summary,
            data.analysis?.summary,
            data.transcript_summary,
            data.transcript,
            metadata.transcript_summary,
        ),
        failureReason:
            firstNonEmpty(
                data.failure_reason,
                data.analysis?.failure_reason,
                data.analysis?.termination_reason,
                data.analysis?.reason,
                data.reason,
                metadata.reason,
            ),
        callDuration: parseDuration(
            data.metadata?.call_duration_secs,
            data.metadata?.call_duration_seconds,
            data.metadata?.call_duration,
            data.call_duration_secs,
            data.call_duration,
            metadata.call_duration_secs,
            metadata.call_duration,
        ),
        couponGenerated,
    };
};

const recalculateCampaignMetrics = async (campaignId) => {
    if (!campaignId) {
        return;
    }

    const [campaign, statusGroups, couponGroups] = await Promise.all([
        prisma.campaign.findUnique({
            where: { id: campaignId },
            select: { status: true, completedAt: true, scheduledAt: true },
        }),
        prisma.campaignContact.groupBy({
            by: ["status"],
            where: { campaignId },
            _count: { _all: true },
        }),
        prisma.campaignCoupon.count({
            where: {
                campaignId,
                status: "SENT"
            },
        }),
    ]);

    const statusCount = statusGroups.reduce((accumulator, group) => {
        accumulator[group.status] = group._count._all;
        return accumulator;
    }, {});

    const totalContacts = Object.values(statusCount).reduce((sum, count) => sum + count, 0);
    const totalCalled =
        (statusCount.CALLING || 0) +
        (statusCount.CALLED || 0) +
        (statusCount.RESPONDED || 0) +
        (statusCount.SENT || 0) +
        (statusCount.DELIVERED || 0) +
        (statusCount.VISITED || 0) +
        (statusCount.CONVERTED || 0) +
        (statusCount.FAILED || 0);
    const totalResponded = (statusCount.RESPONDED || 0) + (statusCount.VISITED || 0);
    const totalConverted = statusCount.CONVERTED || 0;
    const totalFailed = statusCount.FAILED || 0;
    const couponsVisited = statusCount.VISITED || 0;
    const couponsConverted = statusCount.CONVERTED || 0;
    const pendingContacts = (statusCount.PENDING || 0) + (statusCount.CALLING || 0) + (statusCount.SCHEDULED || 0);
    const pausedContacts = statusCount.PAUSED || 0;

    const isCampaignActiveOrPaused = campaign && (campaign.status === "ACTIVE" || campaign.status === "PAUSED");
    // Solo marcar como COMPLETED si ya no hay contactos PENDING, CALLING ni SCHEDULED.
    // Los contactos en PAUSED NO deben permitir que la campaña se marque como COMPLETED automática.
    const shouldMarkCompleted = totalContacts > 0 && pendingContacts === 0 && pausedContacts === 0 && isCampaignActiveOrPaused;

    const campaignUpdateData = {
        totalContacts,
        totalCalled,
        totalResponded,
        totalConverted,
        totalFailed,
        couponsSent: couponGroups,
        couponsVisited,
        couponsConverted,
    };

    let updatedStatus = undefined;

    // Detectar si una campaña SCHEDULED ya llegó a su hora y convertirla a ACTIVE
    if (campaign && campaign.status === "SCHEDULED" && campaign.scheduledAt && new Date() >= campaign.scheduledAt) {
        updatedStatus = "ACTIVE";
    }

    if (shouldMarkCompleted || (updatedStatus === "ACTIVE" && pendingContacts === 0 && totalContacts > 0 && pausedContacts === 0)) {
        campaignUpdateData.status = "COMPLETED";
        campaignUpdateData.completedAt = campaign.completedAt || new Date();
    } else if (updatedStatus === "ACTIVE") {
        campaignUpdateData.status = "ACTIVE";
    }

    await prisma.campaign.update({
        where: { id: campaignId },
        data: campaignUpdateData,
    });
};

const resolveClosedStatusFromContact = (contact) => {
    if (!contact || typeof contact !== "object") {
        return "CALLED";
    }

    if (contact.errorReason) {
        return "FAILED";
    }

    return "CALLED";
};

const handleElevenLabsWebhook = async (req, res, next) => {
    try {
        logger.info("[CampaignWebhook] Webhook received", {
            url: req.originalUrl,
            method: req.method,
            bodySize: req.body ? JSON.stringify(req.body).length : 0,
            hasRawBody: !!req.rawBody,
            hasSignatureHeader: !!req.get("elevenlabs-signature"),
        });

        const signatureHeader = req.get("elevenlabs-signature") || "";
        const webhookSecrets = getWebhookSecrets();
        const allowUnverified = isTruthyEnv(process.env.ALLOW_UNVERIFIED_ELEVENLABS_WEBHOOKS);

        let verified = false;
        let verificationReason = "No webhook secrets configured";

        for (const secret of webhookSecrets) {
            const verification = verifyElevenLabsSignature({
                signatureHeader,
                rawBody: req.rawBody,
                secret,
            });

            if (verification.valid) {
                verified = true;
                verificationReason = "ok";
                break;
            }

            verificationReason = verification.reason;
        }

        if (!verified && !allowUnverified) {
            logger.warn("[CampaignWebhook] Invalid ElevenLabs signature", {
                reason: verificationReason,
                configuredSecrets: webhookSecrets.length,
                signatureHeader: signatureHeader.substring(0, 50),
            });

            return res.status(401).json({
                success: false,
                error: "Invalid webhook signature",
            });
        }

        if (!verified && allowUnverified) {
            logger.warn("[CampaignWebhook] Processing webhook without valid signature (dev override enabled)", {
                reason: verificationReason,
                configuredSecrets: webhookSecrets.length,
            });
        }

        logger.debug("[CampaignWebhook] Signature verified", {
            rawBodyLength: req.rawBody ? req.rawBody.length : 0,
            configuredSecrets: webhookSecrets.length,
            verified,
        });

        const webhookData = extractWebhookData(req.body);

        logger.info("[CampaignWebhook] Extracted webhook data", {
            eventType: webhookData.eventType,
            campaignContactId: webhookData.campaignContactId,
            conversationId: webhookData.conversationId,
            campaignId: webhookData.campaignId,
            providerBatchId: webhookData.providerBatchId,
            phoneNumber: webhookData.phoneNumber,
            callSuccessful: webhookData.callSuccessful,
            failureReason: webhookData.failureReason,
            payload: JSON.stringify(req.body).substring(0, 200),
        });

        if (!isSupportedCampaignWebhookEvent(webhookData.eventType)) {
            logger.info("[CampaignWebhook] Webhook ignored (unsupported event type)", {
                eventType: webhookData.eventType,
                supportedTypes: Array.from(SUPPORTED_EVENT_TYPES),
            });
            return res.status(200).json({
                success: true,
                message: "Webhook ignored (unsupported event type)",
            });
        }

        if (!webhookData.campaignContactId && !webhookData.conversationId) {
            logger.warn("[CampaignWebhook] Missing identifiers in webhook payload", {
                eventType: webhookData.eventType,
                payloadKeys: Object.keys(req.body),
            });
            return res.status(200).json({
                success: true,
                message: "Webhook acknowledged without matching contact",
            });
        }

        let contact = null;
        if (webhookData.campaignContactId) {
            contact = await prisma.campaignContact.findUnique({
                where: { id: webhookData.campaignContactId },
            });
            logger.debug("[CampaignWebhook] Lookup by campaignContactId", {
                campaignContactId: webhookData.campaignContactId,
                found: !!contact,
            });
        }

        if (!contact && webhookData.conversationId) {
            contact = await prisma.campaignContact.findUnique({
                where: { conversationId: webhookData.conversationId },
            });
            logger.debug("[CampaignWebhook] Lookup by conversationId", {
                conversationId: webhookData.conversationId,
                found: !!contact,
            });
        }

        if (!contact && webhookData.providerBatchId) {
            const normalizedPhone = normalizePhoneForLookup(webhookData.phoneNumber);
            const phoneCandidates = [webhookData.phoneNumber, normalizedPhone].filter(Boolean);

            if (phoneCandidates.length > 0) {
                contact = await prisma.campaignContact.findFirst({
                    where: {
                        providerBatchId: webhookData.providerBatchId,
                        webhookReceivedAt: null,
                        OR: phoneCandidates.map((phone) => ({ establishmentPhone: phone })),
                    },
                    orderBy: [{ updatedAt: "desc" }],
                });

                logger.debug("[CampaignWebhook] Lookup by providerBatchId + phone", {
                    providerBatchId: webhookData.providerBatchId,
                    phoneCandidates,
                    found: !!contact,
                });
            }
        }

        if (!contact && webhookData.phoneNumber) {
            const normalizedPhone = normalizePhoneForLookup(webhookData.phoneNumber);
            const phoneCandidates = [webhookData.phoneNumber, normalizedPhone].filter(Boolean);

            // Búsqueda primaria: contactos sin webhook previo y en estado de espera
            contact = await prisma.campaignContact.findFirst({
                where: {
                    webhookReceivedAt: null,
                    AND: [
                        {
                            OR: [
                                { status: "CALLING" },
                                { status: "PAUSED" },
                                { status: "PENDING" },
                                { status: "SCHEDULED" },
                            ],
                        },
                        {
                            OR: phoneCandidates.map((phone) => ({ establishmentPhone: phone })),
                        },
                    ],
                },
                orderBy: [{ sentAt: "desc" }, { updatedAt: "desc" }],
            });

            // Búsqueda secundaria: si el webhook ya fue recibido (webhook duplicado/retry)
            // Matcheamos por phone en contactos que ya tienen webhookReceivedAt reciente
            if (!contact) {
                contact = await prisma.campaignContact.findFirst({
                    where: {
                        AND: [
                            {
                                OR: [
                                    // Solo status finales o con evidencia de llamada
                                    { status: "CALLED" },
                                    { status: "RESPONDED" },
                                    { status: "FAILED" },
                                    { status: "PENDING" },
                                    { status: "SCHEDULED" },
                                ],
                            },
                            {
                                OR: phoneCandidates.map((phone) => ({ establishmentPhone: phone })),
                            },
                            // Webhook reciente (últimos 5 min) - excluye null
                            {
                                webhookReceivedAt: {
                                    not: null,
                                    gte: new Date(Date.now() - 5 * 60 * 1000),
                                },
                            },
                        ],
                    },
                    orderBy: [{ sentAt: "desc" }, { updatedAt: "desc" }],
                });

                if (contact) {
                    logger.debug("[CampaignWebhook] Lookup by phone fallback (with recent webhook)", {
                        phoneCandidates,
                        found: true,
                        currentStatus: contact.status,
                        webhookReceivedAt: contact.webhookReceivedAt,
                    });
                }
            }

            logger.debug("[CampaignWebhook] Lookup by phone fallback", {
                phoneCandidates,
                found: !!contact,
            });
        }

        // Búsqueda terciaria ultra-permisiva: último recurso para los webhooks que se escapan
        // Sin restricciones de status ni webhook - solo phone + campaignId
        if (!contact && webhookData.phoneNumber) {
            const normalizedPhone = normalizePhoneForLookup(webhookData.phoneNumber);
            const phoneCandidates = [webhookData.phoneNumber, normalizedPhone].filter(Boolean);

            contact = await prisma.campaignContact.findFirst({
                where: {
                    AND: [
                        {
                            OR: [
                                { status: "PENDING" },
                                { status: "SCHEDULED" },
                                { status: "CALLING" },
                                { status: "PAUSED" },
                                { status: "CALLED" },
                                { status: "RESPONDED" },
                                { status: "SENT" },
                                { status: "DELIVERED" },
                                { status: "VISITED" },
                                { status: "CONVERTED" },
                                { status: "FAILED" },
                            ],
                        },
                        {
                            OR: phoneCandidates.map((phone) => ({ establishmentPhone: phone })),
                        },
                    ],
                },
                orderBy: [{ sentAt: "desc" }, { updatedAt: "desc" }],
            });

            if (contact) {
                logger.warn("[CampaignWebhook] Lookup by phone (tertiary fallback - ultra-permissive)", {
                    phoneCandidates,
                    found: true,
                    currentStatus: contact.status,
                    webhookReceivedAt: contact.webhookReceivedAt,
                    action: "ultra_permissive_lookup",
                });
            }
        }

        if (!contact) {
            logger.warn("[CampaignWebhook] Contact not found for webhook", {
                campaignContactId: webhookData.campaignContactId,
                conversationId: webhookData.conversationId,
                availableContactIds: "N/A",
            });

            return res.status(200).json({
                success: true,
                message: "Webhook acknowledged without matching contact",
            });
        }

        logger.info("[CampaignWebhook] Contact found", {
            contactId: contact.id,
            currentStatus: contact.status,
            currentConversationId: contact.conversationId,
        });

        // Detectar y manejar webhooks duplicados/replays (idempotencia)
        // Puede suceder si:
        // 1. ElevenLabs reintenta el webhook
        // 2. El contacto ya tiene webhookReceivedAt establecido
        if (contact.webhookReceivedAt) {
            // Si el conversationId coincide, es claramente un webhook duplicado
            if (contact.conversationId === webhookData.conversationId) {
                // Solo hacer heal si el contacto sigue en un estado "stuck"
                if (["CALLING", "PAUSED"].includes(contact.status)) {
                    const healedStatus = resolveClosedStatusFromContact(contact);

                    await prisma.campaignContact.update({
                        where: { id: contact.id },
                        data: {
                            status: healedStatus,
                        },
                    });

                    logger.warn("[CampaignWebhook] Healed inconsistent contact state on idempotent webhook", {
                        campaignId: contact.campaignId,
                        contactId: contact.id,
                        conversationId: webhookData.conversationId,
                        previousStatus: contact.status,
                        newStatus: healedStatus,
                        webhookReceivedAt: contact.webhookReceivedAt,
                    });

                    setImmediate(() => {
                        recalculateCampaignMetrics(contact.campaignId).catch((error) => {
                            logger.error("[CampaignWebhook] Failed to recalculate campaign metrics after idempotent heal", {
                                campaignId: contact.campaignId,
                                contactId: contact.id,
                                error: error.message,
                            });
                        });
                    });
                }

                logger.info("[CampaignWebhook] Idempotent webhook (same contact/conversation)", {
                    campaignId: contact.campaignId,
                    contactId: contact.id,
                    conversationId: webhookData.conversationId,
                    alreadyReceivedAt: contact.webhookReceivedAt,
                });

                return res.status(200).json({
                    success: true,
                    message: "Webhook already processed",
                });
            }

            // Si el conversationId NO coincide pero ya tiene webhookReceivedAt,
            // podría ser un caso de contacto reutilizado en el mismo batch
            logger.warn("[CampaignWebhook] Webhook received for contact with previous webhook but different conversationId", {
                campaignId: contact.campaignId,
                contactId: contact.id,
                newConversationId: webhookData.conversationId,
                previousConversationId: contact.conversationId,
                alreadyReceivedAt: contact.webhookReceivedAt,
            });

            // No procesamos este webhook para evitar sobrescribir datos válidos
            return res.status(200).json({
                success: true,
                message: "Webhook for contact with different conversationId",
            });
        }

        if (webhookData.conversationId) {
            const alreadyProcessed = await prisma.campaignContact.findFirst({
                where: {
                    conversationId: webhookData.conversationId,
                    webhookReceivedAt: { not: null },
                },
                select: {
                    id: true,
                    campaignId: true,
                },
            });

            if (alreadyProcessed && alreadyProcessed.id !== contact.id) {
                logger.info("[CampaignWebhook] Idempotent webhook (conversation already processed)", {
                    campaignId: alreadyProcessed.campaignId,
                    contactId: alreadyProcessed.id,
                    thisContactId: contact.id,
                    conversationId: webhookData.conversationId,
                });

                return res.status(200).json({
                    success: true,
                    message: "Webhook already processed",
                });
            }
        }

        // Verificar estado de la campaña
        const campaignContext = await prisma.campaign.findUnique({
            where: { id: contact.campaignId },
            select: { status: true },
        });

        // Manejo especial para fallos de iniciación de llamada
        if (webhookData.eventType === "call_initiation_failure") {
            const updateData = {
                status: "FAILED",
                errorReason: webhookData.failureReason || "Call failed to initiate (provider error)",
                webhookReceivedAt: new Date(),
            };

            await prisma.campaignContact.update({
                where: { id: contact.id },
                data: updateData,
            });

            logger.warn("[CampaignWebhook] Call initiation failure processed", {
                contactId: contact.id,
                failureReason: updateData.errorReason,
            });

            setImmediate(() => {
                recalculateCampaignMetrics(contact.campaignId).catch((error) => {
                    logger.error("[CampaignWebhook] Failed to recalculate campaign metrics after call initiation failure", {
                        campaignId: contact.campaignId,
                        error: error.message,
                    });
                });
            });

            return res.status(200).json({ success: true });
        }

        // Aunque la campaña esté pausada, los cierres de llamada deben procesarse
        // para evitar perder el resultado y relanzar contactos ya concluidos.

        const status = resolveFinalContactStatus({
            callSuccessful: webhookData.callSuccessful,
            failureReason: webhookData.failureReason,
            callDuration: webhookData.callDuration,
            transcriptSummary: webhookData.transcriptSummary,
        });

        const updateData = {
            status,
            conversationId: webhookData.conversationId || contact.conversationId,
            callDuration: webhookData.callDuration,
            callTranscript: webhookData.transcriptSummary,
            webhookReceivedAt: new Date(),
        };

        logger.info("[CampaignWebhook] Preparing contact update", {
            contactId: contact.id,
            campaignStatus: campaignContext?.status,
            currentStatus: contact.status,
            newStatus: status,
            callDuration: webhookData.callDuration,
        });

        if (status === "FAILED") {
            updateData.errorReason =
                webhookData.failureReason || webhookData.transcriptSummary || "Call completed without success";
        } else {
            updateData.errorReason = null;
        }

        if (webhookData.couponGenerated) {
            let coupon = await prisma.campaignCoupon.findFirst({
                where: {
                    code: webhookData.couponGenerated,
                    campaignId: contact.campaignId,
                },
                select: { id: true },
            });

            if (coupon) {
                updateData.couponId = coupon.id;
                await prisma.campaignCoupon.update({
                    where: { id: coupon.id },
                    data: { status: "SENT", sentAt: new Date() }
                })
                logger.debug("[CampaignWebhook] Coupon found and linked", {
                    couponCode: webhookData.couponGenerated,
                    couponId: coupon.id,
                });
            } else {
                logger.warn("[CampaignWebhook] couponGenerated not found in campaign, creating new one", {
                    campaignId: contact.campaignId,
                    contactId: contact.id,
                    couponCode: webhookData.couponGenerated,
                });

                // Creates the coupon since it wasn't saved in the DB earlier correctly
                const newCoupon = await prisma.campaignCoupon.create({
                    data: {
                        code: webhookData.couponGenerated,
                        campaignId: contact.campaignId,
                        offer: "Oferta especial de llamada",
                        status: "SENT",
                        sentAt: new Date(),
                    }
                });
                updateData.couponId = newCoupon.id;
            }
        }

        logger.debug("[CampaignWebhook] About to update contact in DB", {
            contactId: contact.id,
            updateDataKeys: Object.keys(updateData),
        });

        const updatedContact = await prisma.campaignContact.update({
            where: { id: contact.id },
            data: updateData,
            select: {
                id: true,
                campaignId: true,
                conversationId: true,
                status: true,
            },
        });

        logger.info("[CampaignWebhook] Contact updated successfully", {
            contactId: updatedContact.id,
            newStatus: updatedContact.status,
            conversationId: updatedContact.conversationId,
        });

        setImmediate(() => {
            recalculateCampaignMetrics(updatedContact.campaignId).catch((error) => {
                logger.error("[CampaignWebhook] Failed to recalculate campaign metrics", {
                    campaignId: updatedContact.campaignId,
                    contactId: updatedContact.id,
                    error: error.message,
                });
            });
        });

        logger.info("[CampaignWebhook] Webhook processed", {
            campaignId: updatedContact.campaignId,
            contactId: updatedContact.id,
            conversationId: updatedContact.conversationId,
            status: updatedContact.status,
            couponGenerated: webhookData.couponGenerated || null,
        });

        return res.status(200).json({
            success: true,
            message: "Webhook processed",
        });
    } catch (error) {
        return next(error);
    }
};

module.exports = {
    handleElevenLabsWebhook,
};
