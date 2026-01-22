const prisma = require("../config/database");
const logger = require("../config/logger");

/**
 * createTest
 * Creates a new A/B Test, distributes contacts among variants, and saves to DB.
 * 
 * @param {Object} data
 * @param {string} data.name
 * @param {string} data.description
 * @param {string} data.agentType
 * @param {string[]} data.establishmentIds - IDs of contacts to test
 * @param {Object[]} data.variants - [{ agentConfigId, agentConfigName, voiceId, percentage }]
 */
async function createTest(data) {
    const { name, description, agentType, establishmentIds, variants } = data;

    if (!establishmentIds || establishmentIds.length === 0) {
        throw new Error("No contacts provided for A/B Test");
    }

    // Validate percentages sum to 100
    const totalPercentage = variants.reduce((sum, v) => sum + v.percentage, 0);
    if (totalPercentage !== 100) {
        throw new Error(`Total percentage must be 100, got ${totalPercentage}`);
    }

    return await prisma.$transaction(async (tx) => {
        // 1. Create Test
        const abTest = await tx.abTest.create({
            data: {
                name,
                description,
                agentType,
                status: "DRAFT", // Created but not running yet
            }
        });

        // 2. Create Variants
        const createdVariants = [];
        for (const variant of variants) {
            const v = await tx.abTestVariant.create({
                data: {
                    abTestId: abTest.id,
                    agentConfigId: variant.agentConfigId,
                    agentConfigName: variant.agentConfigName,
                    voiceId: variant.voiceId,
                    percentage: variant.percentage
                }
            });
            createdVariants.push({ ...v, targetCount: Math.floor(establishmentIds.length * (variant.percentage / 100)) });
        }

        // Adjust targetCount for rounding errors (give remainder to first variant)
        const assignedCount = createdVariants.reduce((sum, v) => sum + v.targetCount, 0);
        const remainder = establishmentIds.length - assignedCount;
        if (remainder > 0 && createdVariants.length > 0) {
            createdVariants[0].targetCount += remainder;
        }

        // 3. Shuffle Contacts
        const shuffledContacts = [...establishmentIds].sort(() => 0.5 - Math.random());

        // 4. Distribute Contacts
        let contactIndex = 0;
        const contactsData = [];

        for (const variant of createdVariants) {
            const slice = shuffledContacts.slice(contactIndex, contactIndex + variant.targetCount);
            contactIndex += variant.targetCount;

            for (const contactId of slice) {
                contactsData.push({
                    abTestVariantId: variant.id,
                    contactId: contactId,
                    contactType: "ESTABLISHMENT", // Default for now
                    status: "PENDING"
                });
            }
        }

        if (contactsData.length > 0) {
            await tx.abTestContact.createMany({
                data: contactsData
            });
        }

        return abTest;
    });
}

/**
 * getTestProgress
 * Returns test details with real-time aggregated metrics
 */
async function getTestProgress(testId) {
    const test = await prisma.abTest.findUnique({
        where: { id: testId },
        include: {
            variants: {
                include: {
                    _count: {
                        select: { contacts: true }
                    }
                }
            }
        }
    });

    if (!test) throw new Error("Test not found");

    // Calculate real-time metrics from contacts
    // We prioritize real-time counts over the snapshot fields in Variant for now
    const metrics = await prisma.abTestContact.groupBy({
        by: ['abTestVariantId', 'status'],
        where: {
            variant: {
                abTestId: testId
            }
        },
        _count: {
            id: true
        }
    });

    // Map metrics to variants
    const variantsWithMetrics = test.variants.map(v => {
        const vMetrics = metrics.filter(m => m.abTestVariantId === v.id);

        const totalAssigned = v._count.contacts;
        const completed = vMetrics.find(m => m.status === 'COMPLETED')?._count.id || 0;
        const called = vMetrics.find(m => m.status === 'CALLED')?._count.id || 0; // Or whatever status indicates call made
        const failed = vMetrics.find(m => m.status === 'FAILED')?._count.id || 0;

        // Note: 'totalConverted' logic depends on how we define conversion from the call result
        // For now we just return call statuses

        return {
            ...v,
            metrics: {
                totalAssigned,
                completed,
                called,
                failed
            }
        };
    });

    return {
        ...test,
        variants: variantsWithMetrics
    };
}

/**
 * updateCallResult
 * Updates the contact status and stores the result
 */
async function updateCallResult(contactId, abTestVariantId, resultData) {
    // Find the contact record
    // We need to match both contactId and variantId to ensure uniqueness if contact is in multiple tests (unlikely but possible)
    // or just search by contactId if we assume active test.

    // Better: search by contactId and variantId
    const contact = await prisma.abTestContact.findFirst({
        where: {
            contactId: contactId,
            abTestVariantId: abTestVariantId
        }
    });

    if (!contact) return null; // Not part of a test

    const { status, result } = resultData;

    return await prisma.abTestContact.update({
        where: { id: contact.id },
        data: {
            status: status || contact.status,
            result: result ? JSON.stringify(result) : contact.result,
            calledAt: new Date()
        }
    });
}

/**
 * startTest
 * Updates status to RUNNING. 
 * (Actual call triggering will be handled by a separate job or trigger)
 */
const axios = require("axios");
const prismaGeo = require("../config/database-geo");

/**
 * startTest
 * Updates status to RUNNING and triggers calls asynchronously.
 */
async function startTest(id) {
    const test = await prisma.abTest.update({
        where: { id },
        data: {
            status: "RUNNING",
            startDate: new Date()
        },
        include: {
            variants: {
                include: {
                    contacts: true
                }
            }
        }
    });

    // Trigger calls in background
    triggerTestCalls(test).catch(err => {
        logger.error(`Error triggering calls for test ${id}:`, err);
    });

    return test;
}

/**
 * Helper to fetch contact details (phone)
 */
async function fetchContactDetails(contactId, type) {
    if (type === "ESTABLISHMENT") {
        // Fetch from Geo DB
        const establishment = await prismaGeo.establishment.findUnique({
            where: { id: contactId },
            select: { phone: true }
        });
        return establishment;
    }
    // Handle 'LEAD' type if needed
    return null;
}

/**
 * Trigger calls for a running test
 */
async function triggerTestCalls(test) {
    const SDR_URL = process.env.SDR_AGENT_URL || "http://localhost:8000";
    const QUAL_URL = process.env.QUALIFICATION_AGENT_URL || "http://localhost:8001";
    const API_KEY = process.env.SDR_API_KEY;

    const isSDR = test.agentType === "SDR";
    const baseUrl = isSDR ? SDR_URL : QUAL_URL;
    const endpoint = isSDR ? "/api/sdr/initiate-call" : "/api/qualification/call";

    logger.info(`Starting A/B Test ${test.id} - Triggering calls to ${baseUrl}${endpoint}`);

    for (const variant of test.variants) {
        for (const contact of variant.contacts) {
            if (contact.status !== "PENDING") continue;

            try {
                const contactDetails = await fetchContactDetails(contact.contactId, contact.contactType);

                if (!contactDetails || !contactDetails.phone) {
                    await updateCallResult(contact.contactId, variant.id, { status: "FAILED", result: "No phone number" });
                    continue;
                }

                // Add delay to avoid aggressive rate limiting
                await new Promise(r => setTimeout(r, 1000));

                logger.info(`Triggering call for contact ${contact.contactId} (Variant: ${variant.agentConfigName})`);

                await axios.post(`${baseUrl}${endpoint}`, {
                    establishment_id: contact.contactId,
                    phone: contactDetails.phone,
                    agent_config: {
                        id: variant.agentConfigId,
                        voice_id: variant.voiceId,
                        name: variant.agentConfigName
                    },
                    ab_test_context: {
                        test_id: test.id,
                        variant_id: variant.id,
                        contact_record_id: contact.id
                    }
                }, {
                    headers: { "X-API-Key": API_KEY }
                });

                // Update status to PROCESSED/CALLED. Actual result comes via callback.
                await updateCallResult(contact.contactId, variant.id, { status: "CALLED" });

            } catch (e) {
                logger.error(`Failed to trigger call for ${contact.contactId}`, e.message);
                await updateCallResult(contact.contactId, variant.id, { status: "FAILED", result: e.message });
            }
        }
    }
}

async function listTests() {
    return await prisma.abTest.findMany({
        include: {
            variants: true,
            _count: {
                select: { variants: true }
            }
        },
        orderBy: { createdAt: 'desc' }
    });
}

// Candidates Management
async function addCandidate(establishmentId, userId = null) {
    // Check if exists
    const existing = await prisma.abTestCandidate.findUnique({
        where: { establishmentId }
    });

    if (existing) return existing;

    return await prisma.abTestCandidate.create({
        data: {
            establishmentId,
        }
    });
}

async function addCandidatesBulk(establishmentIds, userId = null) {
    if (!establishmentIds || establishmentIds.length === 0) return { count: 0 };

    // createMany skipDuplicates is supported in Postgres
    return await prisma.abTestCandidate.createMany({
        data: establishmentIds.map(id => ({
            establishmentId: id,
            userId
        })),
        skipDuplicates: true
    });
}

async function removeCandidate(establishmentId) {
    try {
        return await prisma.abTestCandidate.delete({
            where: { establishmentId }
        });
    } catch (e) {
        if (e.code === 'P2025') return null; // Record not found
        throw e;
    }
}

async function getCandidates() {
    return await prisma.abTestCandidate.findMany({
        orderBy: { createdAt: 'desc' }
    });
}

async function clearCandidates() {
    return await prisma.abTestCandidate.deleteMany({});
}

async function stopTest(id) {
    return await prisma.abTest.update({
        where: { id },
        data: {
            status: "COMPLETED", // Or STOPPED/CANCELLED
            endDate: new Date()
        }
    });
}

module.exports = {
    createTest,
    getTestProgress,
    updateCallResult,
    startTest,
    listTests,
    addCandidate,
    removeCandidate,
    addCandidatesBulk,
    getCandidates,
    clearCandidates,
    stopTest
};
