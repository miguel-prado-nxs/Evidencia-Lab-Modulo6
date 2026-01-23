const prisma = require("../config/database");
const logger = require("../config/logger");
const crypto = require("crypto");

/**
 * HASH-BASED DETERMINISTIC ASSIGNMENT
 * Ensures same contact always gets same variant
 */
function assignVariantDeterministic(establishmentId, abTestId, variants) {
    const hash = crypto
        .createHash('md5')
        .update(`${establishmentId}-${abTestId}`)
        .digest('hex');

    const normalized = parseInt(hash.substring(0, 8), 16) / 0xffffffff;

    let cumulative = 0;
    for (const variant of variants) {
        cumulative += variant.percentage / 100;
        if (normalized < cumulative) {
            return variant;
        }
    }

    return variants[variants.length - 1];
}

/**
 * LOG EVENT
 * Logs events to ab_test_events table
 */
async function logEvent({ abTestId, variantId, establishmentId, callLogId, eventType, eventData }) {
    try {
        await prisma.abTestEvent.create({
            data: {
                id: crypto.randomUUID(),
                abTestId,
                variantId,
                establishmentId,
                callLogId,
                eventType,
                eventData: eventData ? JSON.stringify(eventData) : null,
            }
        });
    } catch (error) {
        logger.error(`Failed to log event ${eventType}:`, error);
    }
}

/**
 * LOG CALL INITIATED
 * Creates a call log entry when call is triggered
 */
async function logCallInitiated({
    abTestId,
    variantId,
    agentConfigId,
    establishment,
    attempt,
    batchId
}) {
    const callLogId = crypto.randomUUID();

    await prisma.abTestCallLog.create({
        data: {
            id: callLogId,
            abTestId,
            variantId,
            agentConfigId,
            establishmentId: establishment.id,
            establishmentName: establishment.name,
            phone: establishment.phone,
            employeeRange: establishment.employeeRange,
            address: establishment.address,
            callAttempt: attempt,
            batchId,
            outcome: 'INITIATED'
        }
    });

    await logEvent({
        abTestId,
        variantId,
        establishmentId: establishment.id,
        callLogId,
        eventType: 'CALL_INITIATED',
        eventData: { attempt, batchId }
    });

    return callLogId;
}

/**
 * UPDATE CALL LOG
 * Updates call log with results
 */
async function updateCallLog(callLogId, updates) {
    return await prisma.abTestCallLog.update({
        where: { id: callLogId },
        data: {
            ...updates,
            updatedAt: new Date()
        }
    });
}

/**
 * GET METRICS BY VARIANT
 * Calculates comprehensive metrics per variant
 */
async function getMetricsByVariant(abTestId) {
    const results = await prisma.abTestCallLog.groupBy({
        by: ['variantId'],
        where: { abTestId },
        _count: {
            id: true
        }
    });

    const metrics = [];

    for (const result of results) {
        const variantId = result.variantId;

        // Get detailed counts
        const logs = await prisma.abTestCallLog.findMany({
            where: {
                abTestId,
                variantId
            },
            select: {
                outcome: true,
                durationSec: true,
                prospectCreated: true,
                nextStep: true,
                objectionsCount: true
            }
        });

        const totalCalls = logs.length;
        const connected = logs.filter(l => l.outcome === 'ANSWERED' || l.outcome === 'CONNECTED').length;
        const noAnswer = logs.filter(l => l.outcome === 'NO_ANSWER').length;
        const busy = logs.filter(l => l.outcome === 'BUSY').length;
        const voicemail = logs.filter(l => l.outcome === 'VOICEMAIL').length;
        const failed = logs.filter(l => l.outcome === 'FAILED').length;
        const prospects = logs.filter(l => l.prospectCreated).length;
        const followUps = logs.filter(l => l.nextStep).length;

        const durations = logs.filter(l => l.durationSec).map(l => l.durationSec);
        const avgDuration = durations.length > 0
            ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
            : 0;

        const avgObjections = logs.length > 0
            ? logs.reduce((sum, l) => sum + (l.objectionsCount || 0), 0) / logs.length
            : 0;

        metrics.push({
            variantId,
            totalCalls,
            connected,
            noAnswer,
            busy,
            voicemail,
            failed,
            prospects,
            followUps,
            connectionRate: totalCalls > 0 ? ((connected / totalCalls) * 100).toFixed(1) : 0,
            conversionRate: connected > 0 ? ((prospects / connected) * 100).toFixed(1) : 0,
            followUpRate: prospects > 0 ? ((followUps / prospects) * 100).toFixed(1) : 0,
            avgDuration,
            avgObjections: avgObjections.toFixed(2)
        });
    }

    return metrics;
}

/**
 * CALCULATE STATISTICAL SIGNIFICANCE
 * Simple z-test for proportion comparison
 */
function calculateSignificance(variantA, variantB) {
    const n1 = variantA.connected;
    const n2 = variantB.connected;

    if (n1 < 30 || n2 < 30) {
        return { significant: false, reason: 'Sample size too small (< 30)' };
    }

    const p1 = variantA.prospects / n1;
    const p2 = variantB.prospects / n2;

    const pooled = (variantA.prospects + variantB.prospects) / (n1 + n2);
    const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));

    if (se === 0) {
        return { significant: false, reason: 'No variance' };
    }

    const z = (p2 - p1) / se;
    const zAbs = Math.abs(z);

    // z > 1.96 → 95% confidence
    // z > 2.58 → 99% confidence
    return {
        zScore: z.toFixed(3),
        significant: zAbs > 1.96,
        confidence: zAbs > 2.58 ? 99 : (zAbs > 1.96 ? 95 : 0),
        difference: ((p2 - p1) * 100).toFixed(1) + 'pp'
    };
}

/**
 * GET WINNER
 * Declares a winner based on conversion rate and statistical significance
 */
async function getWinner(abTestId) {
    const metrics = await getMetricsByVariant(abTestId);

    if (metrics.length < 2) {
        return { winner: null, reason: 'Not enough variants' };
    }

    // Find best conversion rate
    const sorted = [...metrics].sort((a, b) =>
        parseFloat(b.conversionRate) - parseFloat(a.conversionRate)
    );

    const best = sorted[0];
    const second = sorted[1];

    // Check minimum sample size
    if (best.connected < 100) {
        return {
            winner: null,
            reason: `Insufficient sample size (${best.connected}/100 calls connected)`,
            currentLeader: best.variantId,
            metrics
        };
    }

    // Check significance
    const significance = calculateSignificance(second, best);

    if (!significance.significant) {
        return {
            winner: null,
            reason: `No statistically significant difference (${significance.reason || 'p > 0.05'})`,
            currentLeader: best.variantId,
            metrics,
            significance
        };
    }

    // Check minimum difference (5pp)
    const diff = parseFloat(best.conversionRate) - parseFloat(second.conversionRate);
    if (diff < 5) {
        return {
            winner: null,
            reason: `Difference too small (${diff.toFixed(1)}pp < 5pp minimum)`,
            currentLeader: best.variantId,
            metrics,
            significance
        };
    }

    return {
        winner: best.variantId,
        conversionRate: best.conversionRate,
        metrics,
        significance,
        recommendation: `Variant ${best.variantId} is the winner with ${best.conversionRate}% conversion (${significance.confidence}% confidence)`
    };
}

/**
 * SHOULD RETRY
 * Determines if a contact should be retried
 */
function shouldRetry(callLog, maxRetries = 3, retryDelayHours = 24) {
    if (callLog.callAttempt >= maxRetries) {
        return false;
    }

    const retryableOutcomes = ['NO_ANSWER', 'BUSY', 'VOICEMAIL'];
    if (!retryableOutcomes.includes(callLog.outcome)) {
        return false;
    }

    const hoursSinceAttempt = (Date.now() - new Date(callLog.initiatedAt)) / 3600000;
    return hoursSinceAttempt >= retryDelayHours;
}

/**
 * GET CONTACTS FOR RETRY
 * Returns contacts that should be retried
 */
async function getContactsForRetry(abTestId, maxRetries = 3, retryDelayHours = 24) {
    const logs = await prisma.abTestCallLog.findMany({
        where: {
            abTestId,
            callAttempt: { lt: maxRetries },
            outcome: { in: ['NO_ANSWER', 'BUSY', 'VOICEMAIL'] }
        },
        orderBy: { initiatedAt: 'asc' }
    });

    const toRetry = logs.filter(log => shouldRetry(log, maxRetries, retryDelayHours));

    return toRetry.map(log => ({
        establishmentId: log.establishmentId,
        variantId: log.variantId,
        lastAttempt: log.callAttempt,
        lastOutcome: log.outcome,
        lastAttemptedAt: log.initiatedAt
    }));
}

// Export original functions + new ones
const originalService = require("./abTestsService.js");

module.exports = {
    ...originalService,
    assignVariantDeterministic,
    logEvent,
    logCallInitiated,
    updateCallLog,
    getMetricsByVariant,
    calculateSignificance,
    getWinner,
    shouldRetry,
    getContactsForRetry
};
