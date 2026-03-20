const crypto = require("crypto");
const prisma = require("../config/database");
const logger = require("../config/logger");

const SUPPORTED_EVENT_TYPES = new Set([
    "post_call_transcription",
    "post_call_report",
    "call_ended",
    "conversation_ended",
    "conversation.ended",
]);

const isSupportedCampaignWebhookEvent = (eventType) => {
    if (!eventType || typeof eventType !== "string") {
        return false;
    }

    if (SUPPORTED_EVENT_TYPES.has(eventType)) {
        return true;
    }

    const normalized = eventType.toLowerCase();
    return normalized.includes("post_call") || normalized.includes("ended");
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

const extractWebhookData = (payload = {}) => {
    const data = payload.data && typeof payload.data === "object" ? payload.data : {};
    const metadata = data.metadata && typeof data.metadata === "object" ? data.metadata : {};
    const conversationInitData =
        data.conversation_initiation_client_data && typeof data.conversation_initiation_client_data === "object"
            ? data.conversation_initiation_client_data
            : {};

    const customLlmData =
        (data.custom_llm_data && typeof data.custom_llm_data === "object" && data.custom_llm_data) ||
        (conversationInitData.dynamic_variables &&
            typeof conversationInitData.dynamic_variables === "object" &&
            conversationInitData.dynamic_variables) ||
        (metadata.dynamic_variables && typeof metadata.dynamic_variables === "object" && metadata.dynamic_variables) ||
        (data.dynamic_variables && typeof data.dynamic_variables === "object" && data.dynamic_variables) ||
        {};

    const conversationId = data.conversation_id || data.conversationId || null;
    const campaignContactId =
        customLlmData.campaignContactId ||
        customLlmData.campaign_contact_id ||
        data.campaignContactId ||
        data.campaign_contact_id ||
        null;
    const campaignId = customLlmData.campaignId || customLlmData.campaign_id || data.campaignId || null;
    const couponGenerated =
        customLlmData.couponGenerated || customLlmData.coupon_generated || data.couponGenerated || null;

    return {
        eventType: payload.type || payload.event_type || data.type || null,
        campaignId,
        campaignContactId,
        conversationId,
        callSuccessful:
            data.analysis?.call_successful === true ||
            data.analysis?.call_successful === "true" ||
            data.analysis?.success === true,
        transcriptSummary: data.analysis?.transcript_summary || null,
        failureReason:
            data.analysis?.failure_reason ||
            data.analysis?.termination_reason ||
            data.analysis?.reason ||
            null,
        callDuration:
            typeof data.metadata?.call_duration_secs === "number" ? data.metadata.call_duration_secs : null,
        couponGenerated,
    };
};

const recalculateCampaignMetrics = async (campaignId) => {
    if (!campaignId) {
        return;
    }

    const [statusGroups, couponGroups] = await Promise.all([
        prisma.campaignContact.groupBy({
            by: ["status"],
            where: { campaignId },
            _count: { _all: true },
        }),
        prisma.campaignContact.count({
            where: {
                campaignId,
                couponId: { not: null },
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

    await prisma.campaign.update({
        where: { id: campaignId },
        data: {
            totalContacts,
            totalCalled,
            totalResponded,
            totalConverted,
            totalFailed,
            couponsSent: couponGroups,
            couponsVisited,
            couponsConverted,
        },
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
        const verification = verifyElevenLabsSignature({
            signatureHeader,
            rawBody: req.rawBody,
            secret: process.env.ELEVENLABS_WEBHOOK_SECRET,
        });

        if (!verification.valid) {
            logger.warn("[CampaignWebhook] Invalid ElevenLabs signature", {
                reason: verification.reason,
                hasSecret: !!process.env.ELEVENLABS_WEBHOOK_SECRET,
                signatureHeader: signatureHeader.substring(0, 50),
            });

            return res.status(401).json({
                success: false,
                error: "Invalid webhook signature",
            });
        }

        logger.debug("[CampaignWebhook] Signature verified", {
            rawBodyLength: req.rawBody ? req.rawBody.length : 0,
        });

        const webhookData = extractWebhookData(req.body);

        logger.info("[CampaignWebhook] Extracted webhook data", {
            eventType: webhookData.eventType,
            campaignContactId: webhookData.campaignContactId,
            conversationId: webhookData.conversationId,
            campaignId: webhookData.campaignId,
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

        if (contact.webhookReceivedAt && contact.conversationId === webhookData.conversationId) {
            if (contact.status === "CALLING") {
                const healedStatus = resolveClosedStatusFromContact(contact);

                await prisma.campaignContact.update({
                    where: { id: contact.id },
                    data: {
                        status: healedStatus,
                    },
                });

                logger.warn("[CampaignWebhook] Healed inconsistent CALLING state on idempotent webhook", {
                    campaignId: contact.campaignId,
                    contactId: contact.id,
                    conversationId: webhookData.conversationId,
                    previousStatus: "CALLING",
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

        const status = webhookData.callSuccessful ? "CALLED" : "FAILED";
        const updateData = {
            status,
            conversationId: webhookData.conversationId || contact.conversationId,
            callDuration: webhookData.callDuration,
            callTranscript: webhookData.transcriptSummary,
            webhookReceivedAt: new Date(),
        };

        logger.info("[CampaignWebhook] Preparing contact update", {
            contactId: contact.id,
            currentStatus: contact.status,
            newStatus: status,
            callDuration: webhookData.callDuration,
        });

        if (!webhookData.callSuccessful) {
            updateData.errorReason =
                webhookData.failureReason || webhookData.transcriptSummary || "Call completed without success";
        }

        if (webhookData.couponGenerated) {
            const coupon = await prisma.campaignCoupon.findFirst({
                where: {
                    code: webhookData.couponGenerated,
                    campaignId: contact.campaignId,
                },
                select: { id: true },
            });

            if (coupon) {
                updateData.couponId = coupon.id;
                logger.debug("[CampaignWebhook] Coupon found and linked", {
                    couponCode: webhookData.couponGenerated,
                    couponId: coupon.id,
                });
            } else {
                logger.warn("[CampaignWebhook] couponGenerated not found in campaign", {
                    campaignId: contact.campaignId,
                    contactId: contact.id,
                    couponCode: webhookData.couponGenerated,
                });
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
