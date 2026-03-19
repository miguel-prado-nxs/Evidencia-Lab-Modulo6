const crypto = require("crypto");
const prisma = require("../config/database");
const logger = require("../config/logger");

const EVENT_TYPE_POST_CALL_TRANSCRIPTION = "post_call_transcription";

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

    const bodyString = typeof rawBody === "string" ? rawBody : "";
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
    const customLlmData =
        (data.custom_llm_data && typeof data.custom_llm_data === "object" && data.custom_llm_data) ||
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
        eventType: payload.type || null,
        campaignId,
        campaignContactId,
        conversationId,
        callSuccessful: data.analysis?.call_successful === true,
        transcriptSummary: data.analysis?.transcript_summary || null,
        failureReason: data.analysis?.failure_reason || null,
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

const handleElevenLabsWebhook = async (req, res, next) => {
    try {
        const signatureHeader = req.get("elevenlabs-signature") || "";
        const verification = verifyElevenLabsSignature({
            signatureHeader,
            rawBody: req.rawBody,
            secret: process.env.ELEVENLABS_WEBHOOK_SECRET,
        });

        if (!verification.valid) {
            logger.warn("[CampaignWebhook] Invalid ElevenLabs signature", {
                reason: verification.reason,
            });

            return res.status(401).json({
                success: false,
                error: "Invalid webhook signature",
            });
        }

        const webhookData = extractWebhookData(req.body);

        if (webhookData.eventType !== EVENT_TYPE_POST_CALL_TRANSCRIPTION) {
            return res.status(200).json({
                success: true,
                message: "Webhook ignored (unsupported event type)",
            });
        }

        if (!webhookData.campaignContactId && !webhookData.conversationId) {
            logger.warn("[CampaignWebhook] Missing identifiers in webhook payload", {
                eventType: webhookData.eventType,
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
        }

        if (!contact && webhookData.conversationId) {
            contact = await prisma.campaignContact.findUnique({
                where: { conversationId: webhookData.conversationId },
            });
        }

        if (!contact) {
            logger.warn("[CampaignWebhook] Contact not found for webhook", {
                campaignContactId: webhookData.campaignContactId,
                conversationId: webhookData.conversationId,
            });

            return res.status(200).json({
                success: true,
                message: "Webhook acknowledged without matching contact",
            });
        }

        if (contact.webhookReceivedAt && contact.conversationId === webhookData.conversationId) {
            logger.info("[CampaignWebhook] Idempotent webhook (same contact/conversation)", {
                campaignId: contact.campaignId,
                contactId: contact.id,
                conversationId: webhookData.conversationId,
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
            } else {
                logger.warn("[CampaignWebhook] couponGenerated not found in campaign", {
                    campaignId: contact.campaignId,
                    contactId: contact.id,
                    couponCode: webhookData.couponGenerated,
                });
            }
        }

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
