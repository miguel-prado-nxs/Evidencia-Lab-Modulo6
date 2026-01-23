/**
 * A/B TEST BATCH RUNNER
 * 
 * Script para ejecutar lotes de llamadas para A/B testing
 * Incluye rate limiting, reintentos, y logging detallado
 * 
 * Usage: node runABTestBatch.js <ab_test_id>
 */

const prisma = require("../src/config/database");
const prismaGeo = require("../src/config/database-geo");
const abTestService = require("../src/services/abTestsServiceExtended");
const axios = require("axios");
const crypto = require("crypto");

// Configuration
const BATCH_CONFIG = {
    batchSize: 50,              // Llamadas por lote
    batchIntervalMinutes: 30,   // Espera entre lotes
    maxCallsPerHour: 100,       // Rate limit global
    allowedHours: {
        start: 9,               // 9am
        end: 20                 // 8pm
    },
    maxRetries: 3,              // Reintentos por contacto
    retryDelayHours: 24,        // Espera entre reintentos
    delayBetweenCalls: 2000     // 2 segundos entre llamadas
};

class RateLimiter {
    constructor() {
        this.callsThisHour = 0;
        this.hourStart = Date.now();
    }

    canMakeCall() {
        const now = Date.now();
        const hour = new Date(now).getHours();

        // Reset contador cada hora
        if (now - this.hourStart > 3600000) {
            this.callsThisHour = 0;
            this.hourStart = now;
        }

        // Validar horario
        if (hour < BATCH_CONFIG.allowedHours.start ||
            hour >= BATCH_CONFIG.allowedHours.end) {
            return { allowed: false, reason: 'OUTSIDE_HOURS' };
        }

        // Validar límite/hora
        if (this.callsThisHour >= BATCH_CONFIG.maxCallsPerHour) {
            return { allowed: false, reason: 'RATE_LIMIT' };
        }

        return { allowed: true };
    }

    recordCall() {
        this.callsThisHour++;
    }
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

async function fetchEstablishmentDetails(establishmentId) {
    try {
        const establishment = await prismaGeo.establishment.findUnique({
            where: { id: establishmentId },
            select: {
                id: true,
                name: true,
                phone: true,
                employee_range: true,
                address: true
            }
        });
        return establishment;
    } catch (error) {
        console.error(`Failed to fetch establishment ${establishmentId}:`, error.message);
        return null;
    }
}

async function initiateCall({ establishment, variant, abTestId, attempt, batchId }) {
    const AGENTS_SDK_URL = process.env.AGENTS_SDK_URL || "http://localhost:8000";
    const API_KEY = process.env.SDR_API_KEY;

    if (!establishment.phone) {
        throw new Error('No phone number');
    }

    // Log call initiated
    const callLogId = await abTestService.logCallInitiated({
        abTestId,
        variantId: variant.id,
        agentConfigId: variant.agentConfigId,
        establishment: {
            id: establishment.id,
            name: establishment.name,
            phone: establishment.phone,
            employeeRange: establishment.employee_range,
            address: establishment.address
        },
        attempt,
        batchId
    });

    console.log(`  → Calling ${establishment.name} (${establishment.phone})`);
    console.log(`     Variant: ${variant.agentConfigName} | Attempt: ${attempt} | Log ID: ${callLogId}`);

    try {
        // Make the call
        const response = await axios.post(
            `${AGENTS_SDK_URL}/api/sdr/initiate-call`,
            {
                establishment_id: establishment.id,
                establishment_name: establishment.name,
                phone: establishment.phone,
                employee_range: establishment.employee_range,
                address: establishment.address,

                // A/B Test context
                ab_test_id: abTestId,
                variant_id: variant.id,
                agent_config_id: variant.agentConfigId,
                call_attempt: attempt,
                batch_id: batchId,
                call_log_id: callLogId,

                // Agent config
                agent_config: {
                    id: variant.agentConfigId,
                    name: variant.agentConfigName,
                    voice_id: variant.voiceId
                }
            },
            {
                headers: { "X-API-Key": API_KEY },
                timeout: 10000
            }
        );

        // Update log with call ID
        if (response.data && response.data.call_id) {
            await abTestService.updateCallLog(callLogId, {
                callId: response.data.call_id,
                outcome: 'CONNECTING'
            });
        }

        console.log(`  ✓ Call initiated successfully`);
        return { success: true, callLogId };

    } catch (error) {
        console.error(`  ✗ Call failed:`, error.message);

        // Update log with error
        await abTestService.updateCallLog(callLogId, {
            outcome: 'FAILED',
            errorMessage: error.message
        });

        return { success: false, error: error.message, callLogId };
    }
}

async function runBatch(abTestId) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`A/B TEST BATCH RUNNER`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Test ID: ${abTestId}`);
    console.log(`Started at: ${new Date().toISOString()}\n`);

    // Get test details
    const test = await prisma.abTest.findUnique({
        where: { id: abTestId },
        include: {
            variants: {
                include: {
                    contacts: {
                        where: {
                            status: { in: ['PENDING', 'FAILED'] }
                        }
                    }
                }
            }
        }
    });

    if (!test) {
        throw new Error(`Test not found: ${abTestId}`);
    }

    if (test.status !== 'RUNNING') {
        throw new Error(`Test is not RUNNING (status: ${test.status})`);
    }

    console.log(`Test: ${test.name}`);
    console.log(`Agent Type: ${test.agentType}`);
    console.log(`Variants: ${test.variants.length}\n`);

    // Collect all contacts
    let allContacts = [];
    for (const variant of test.variants) {
        for (const contact of variant.contacts) {
            allContacts.push({
                contactId: contact.contactId,
                variantId: variant.id,
                variant: variant,
                status: contact.status,
                attemptCount: contact.attemptCount || 0
            });
        }
    }

    console.log(`Total contacts to process: ${allContacts.length}`);

    // Shuffle to avoid bias
    allContacts = await shuffleArray(allContacts);

    // Take batch
    const batch = allContacts.slice(0, BATCH_CONFIG.batchSize);
    console.log(`Processing batch: ${batch.length} contacts\n`);

    const batchId = `batch_${Date.now()}`;
    const rateLimiter = new RateLimiter();

    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;

    for (const item of batch) {
        // Check rate limit
        const canCall = rateLimiter.canMakeCall();
        if (!canCall.allowed) {
            console.log(`\n⚠️  Rate limit: ${canCall.reason}`);
            if (canCall.reason === 'OUTSIDE_HOURS') {
                console.log(`   Current hour: ${new Date().getHours()}h (allowed: ${BATCH_CONFIG.allowedHours.start}-${BATCH_CONFIG.allowedHours.end}h)`);
                break;
            } else if (canCall.reason === 'RATE_LIMIT') {
                console.log(`   Reached ${BATCH_CONFIG.maxCallsPerHour} calls/hour limit`);
                console.log(`   Waiting 1 hour...`);
                await sleep(3600000);
                rateLimiter.callsThisHour = 0;
                rateLimiter.hourStart = Date.now();
            }
        }

        // Fetch establishment details
        console.log(`\n[${successCount + failCount + skippedCount + 1}/${batch.length}]`);
        const establishment = await fetchEstablishmentDetails(item.contactId);

        if (!establishment) {
            console.log(`  ⊘ Skipped: Establishment not found`);
            skippedCount++;
            continue;
        }

        // Check retry logic
        const attempt = item.attemptCount + 1;
        if (attempt > BATCH_CONFIG.maxRetries) {
            console.log(`  ⊘ Skipped: Max retries exceeded (${attempt - 1}/${BATCH_CONFIG.maxRetries})`);
            skippedCount++;
            continue;
        }

        // Initiate call
        const result = await initiateCall({
            establishment,
            variant: item.variant,
            abTestId,
            attempt,
            batchId
        });

        if (result.success) {
            successCount++;
            rateLimiter.recordCall();
        } else {
            failCount++;
        }

        // Update contact attempt count
        await prisma.abTestContact.updateMany({
            where: {
                contactId: item.contactId,
                abTestVariantId: item.variantId
            },
            data: {
                attemptCount: attempt,
                lastAttemptedAt: new Date(),
                batchId
            }
        });

        // Delay between calls
        await sleep(BATCH_CONFIG.delayBetweenCalls);
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`BATCH SUMMARY`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Batch ID: ${batchId}`);
    console.log(`Success: ${successCount}`);
    console.log(`Failed: ${failCount}`);
    console.log(`Skipped: ${skippedCount}`);
    console.log(`Total: ${successCount + failCount + skippedCount}`);
    console.log(`Completed at: ${new Date().toISOString()}`);
    console.log(`${'='.repeat(80)}\n`);
}

async function runContinuousBatches(abTestId) {
    console.log(`Starting continuous batch runner for test: ${abTestId}\n`);

    while (true) {
        try {
            // Check if test is still running
            const test = await prisma.abTest.findUnique({
                where: { id: abTestId },
                select: { status: true }
            });

            if (!test || test.status !== 'RUNNING') {
                console.log(`\nTest is no longer RUNNING. Stopping batch runner.`);
                break;
            }

            // Run one batch
            await runBatch(abTestId);

            // Wait before next batch
            console.log(`\nWaiting ${BATCH_CONFIG.batchIntervalMinutes} minutes before next batch...\n`);
            await sleep(BATCH_CONFIG.batchIntervalMinutes * 60 * 1000);

        } catch (error) {
            console.error(`\n❌ Error in batch:`, error);
            console.log(`Waiting 5 minutes before retry...\n`);
            await sleep(5 * 60 * 1000);
        }
    }

    console.log(`\nBatch runner stopped.`);
}

// Main execution
const abTestId = process.argv[2];
const continuous = process.argv.includes('--continuous');

if (!abTestId) {
    console.error('Usage: node runABTestBatch.js <ab_test_id> [--continuous]');
    console.error('\nOptions:');
    console.error('  --continuous    Run batches continuously until test is stopped');
    process.exit(1);
}

const runner = continuous ? runContinuousBatches : runBatch;

runner(abTestId)
    .then(() => {
        console.log('\n✅ Done');
        process.exit(0);
    })
    .catch(err => {
        console.error('\n❌ Fatal error:', err);
        process.exit(1);
    });
