const prisma = require("../config/database");
const logger = require("../config/logger");

let isRunning = false;
let intervalId = null;
let isCycleRunning = false;

const DEFAULT_INTERVAL_MS = 60 * 1000;
const DEFAULT_ORPHAN_TIMEOUT_HOURS = 4;

const getIntervalMs = () => {
    const parsed = Number.parseInt(process.env.CAMPAIGN_RECONCILIATION_INTERVAL_MS || "", 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return DEFAULT_INTERVAL_MS;
    }
    return parsed;
};

const getOrphanTimeoutHours = () => {
    const parsed = Number.parseInt(process.env.CAMPAIGN_CALLING_TIMEOUT_HOURS || "", 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return DEFAULT_ORPHAN_TIMEOUT_HOURS;
    }
    return parsed;
};

const getOrphanThresholdDate = () => {
    const orphanTimeoutHours = getOrphanTimeoutHours();
    return new Date(Date.now() - orphanTimeoutHours * 60 * 60 * 1000);
};

const recalculateCampaignMetrics = async (campaignId) => {
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
    const pendingContacts = (statusCount.PENDING || 0) + (statusCount.CALLING || 0) + (statusCount.SCHEDULED || 0);
    const pausedContacts = statusCount.PAUSED || 0;

    const isCampaignActiveOrPaused = campaign && (campaign.status === "ACTIVE" || campaign.status === "PAUSED");
    // Solo marcar como COMPLETED si ya no hay contactos PENDING, CALLING ni SCHEDULED.
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

    if (campaign && campaign.status === "SCHEDULED" && updatedStatus === "ACTIVE") {
        await prisma.campaignContact.updateMany({
            where: {
                campaignId: campaignId,
                status: "SCHEDULED"
            },
            data: {
                status: "PENDING"
            }
        });
        logger.info(`[CampaignReconciliationWorker] Campaign ${campaignId} activated. Contacts moved to PENDING.`);
    }
};

const appendReconciliationErrorMessage = (establishmentData, errorMessage) => {
    const previous = establishmentData && typeof establishmentData === "object" ? establishmentData : {};
    const previousReconciliation =
        previous.reconciliation && typeof previous.reconciliation === "object"
            ? previous.reconciliation
            : {};

    return {
        ...previous,
        reconciliation: {
            ...previousReconciliation,
            errorMessage,
            lastCheckedAt: new Date().toISOString(),
        },
    };
};

const isAlreadyProcessedByConversation = async (contact) => {
    if (!contact.conversationId) {
        return null;
    }

    return prisma.campaignContact.findFirst({
        where: {
            conversationId: contact.conversationId,
            webhookReceivedAt: { not: null },
        },
        select: {
            id: true,
            campaignId: true,
            webhookReceivedAt: true,
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

const reconcileContact = async (contact, orphanThreshold) => {
    const context = {
        campaignId: contact.campaignId,
        contactId: contact.id,
        providerBatchId: contact.providerBatchId,
        status: contact.status,
    };

    const processedByConversation = await isAlreadyProcessedByConversation(contact);
    if (processedByConversation) {
        if (processedByConversation.id === contact.id && contact.status === "CALLING") {
            const resolvedStatus = resolveClosedStatusFromContact(contact);

            await prisma.campaignContact.update({
                where: { id: contact.id },
                data: {
                    status: resolvedStatus,
                },
            });

            logger.warn("[CampaignReconciliationWorker] Contact healed from inconsistent state", {
                ...context,
                conversationId: contact.conversationId,
                webhookReceivedAt: processedByConversation.webhookReceivedAt,
                processedContactId: processedByConversation.id,
                action: "healed_closed_contact_state",
                previousStatus: "CALLING",
                newStatus: resolvedStatus,
            });

            return { updated: true, reason: "healed_inconsistent_state" };
        }

        logger.info("[CampaignReconciliationWorker] Contact skipped (already closed by webhook)", {
            ...context,
            conversationId: contact.conversationId,
            webhookReceivedAt: processedByConversation.webhookReceivedAt,
            processedContactId: processedByConversation.id,
            action: "idempotency_skip",
        });
        return { updated: false, reason: "idempotent" };
    }

    if (!["CALLING", "PAUSED"].includes(contact.status)) {
        return { updated: false, reason: "not_calling_or_paused" };
    }

    const createdAt = new Date(contact.createdAt);
    if (createdAt > orphanThreshold) {
        return { updated: false, reason: "within_timeout_window" };
    }

    const timeoutHours = getOrphanTimeoutHours();
    const errorReason = `Reconciliation timeout: ${contact.status} without closure for more than ${timeoutHours}h`;

    await prisma.campaignContact.update({
        where: { id: contact.id },
        data: {
            status: "FAILED",
            errorReason,
            establishmentData: appendReconciliationErrorMessage(contact.establishmentData, errorReason),
        },
    });

    logger.warn("[CampaignReconciliationWorker] Orphan contact moved to FAILED", {
        ...context,
        action: "orphan_timeout_failed",
        errorReason,
    });

    return { updated: true, reason: "orphan_timeout" };
};

const runCycle = async () => {
    if (!isRunning) {
        return;
    }

    if (isCycleRunning) {
        logger.warn("[CampaignReconciliationWorker] Previous cycle still running, skipping this interval");
        return;
    }

    isCycleRunning = true;

    try {
        const campaigns = await prisma.campaign.findMany({
            where: {
                OR: [
                    {
                        status: "ACTIVE",
                        contacts: {
                            some: {
                                providerBatchId: { not: null },
                            },
                        },
                    },
                    {
                        status: "SCHEDULED",
                    },
                ],
            },
            select: {
                id: true,
            },
        });

        if (campaigns.length === 0) {
            logger.info("[CampaignReconciliationWorker] No active campaigns with batch contacts to reconcile");
            return;
        }

        const orphanThreshold = getOrphanThresholdDate();
        const summary = {
            campaignsProcessed: 0,
            contactsScanned: 0,
            contactsUpdated: 0,
            idempotentSkips: 0,
            errors: 0,
        };

        for (const campaign of campaigns) {
            try {
                const contacts = await prisma.campaignContact.findMany({
                    where: {
                        campaignId: campaign.id,
                        providerBatchId: { not: null },
                    },
                    select: {
                        id: true,
                        campaignId: true,
                        providerBatchId: true,
                        status: true,
                        errorReason: true,
                        conversationId: true,
                        webhookReceivedAt: true,
                        createdAt: true,
                        establishmentData: true,
                    },
                });

                summary.campaignsProcessed += 1;
                summary.contactsScanned += contacts.length;

                for (const contact of contacts) {
                    try {
                        const result = await reconcileContact(contact, orphanThreshold);
                        if (result.updated) {
                            summary.contactsUpdated += 1;
                        }
                        if (result.reason === "idempotent") {
                            summary.idempotentSkips += 1;
                        }
                    } catch (error) {
                        summary.errors += 1;
                        logger.error("[CampaignReconciliationWorker] Failed to reconcile contact", {
                            campaignId: contact.campaignId,
                            contactId: contact.id,
                            providerBatchId: contact.providerBatchId,
                            error: error.message,
                        });
                    }
                }

                await recalculateCampaignMetrics(campaign.id);
            } catch (error) {
                summary.errors += 1;
                logger.error("[CampaignReconciliationWorker] Failed to process campaign", {
                    campaignId: campaign.id,
                    error: error.message,
                });
            }
        }

        logger.info("[CampaignReconciliationWorker] Cycle completed", summary);
    } catch (error) {
        logger.error("[CampaignReconciliationWorker] Cycle failed", {
            error: error.message,
        });
    } finally {
        isCycleRunning = false;
    }
};

const start = () => {
    if (isRunning) {
        logger.warn("[CampaignReconciliationWorker] Worker already running");
        return;
    }

    isRunning = true;
    const intervalMs = getIntervalMs();

    logger.info("[CampaignReconciliationWorker] Worker started", {
        intervalMs,
        orphanTimeoutHours: getOrphanTimeoutHours(),
    });

    setTimeout(() => {
        runCycle().catch((error) => {
            logger.error("[CampaignReconciliationWorker] Initial cycle failed", {
                error: error.message,
            });
        });
    }, 5000);

    intervalId = setInterval(() => {
        runCycle().catch((error) => {
            logger.error("[CampaignReconciliationWorker] Interval cycle failed", {
                error: error.message,
            });
        });
    }, intervalMs);
};

const stop = () => {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
    isRunning = false;
    isCycleRunning = false;
    logger.info("[CampaignReconciliationWorker] Worker stopped");
};

const getStatus = () => {
    return {
        isRunning,
        isCycleRunning,
        intervalMs: getIntervalMs(),
        orphanTimeoutHours: getOrphanTimeoutHours(),
    };
};

module.exports = {
    start,
    stop,
    getStatus,
};

