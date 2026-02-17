const prisma = require("../config/database");
const prismaGeo = require("../config/database-geo");
const logger = require("../config/logger");
const axios = require("axios");
const { enqueueSDRCall, enqueueQualificationCall } = require("../queues");

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
 * @param {string} [data.createdBy] - User ID quien creo el test
 */
async function createTest(data) {
    const { name, description, agentType, establishmentIds, variants, createdBy } = data;

    if (!establishmentIds || establishmentIds.length === 0) {
        throw new Error("No contacts provided for A/B Test");
    }

    // Validar que el número de variantes no exceda el número de contactos
    if (variants.length > establishmentIds.length) {
        throw new Error(`Cannot create test with ${variants.length} variants and only ${establishmentIds.length} contacts. You need at least 1 contact per variant.`);
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
                status: "DRAFT",
                createdBy: createdBy || null,
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
 * fetchAgentConfig
 * Fetch full agent configuration from demo-form-service
 */
async function fetchAgentConfig(agentConfigId) {
    const DEMO_FORM_URL = process.env.DEMO_FORM_SERVICE_URL || "http://localhost:3001/api";
    const AGENTS_CONFIG_KEY = process.env.AGENTS_CONFIG_KEY;

    try {
        const response = await axios.get(
            `${DEMO_FORM_URL}/agent-configs/${agentConfigId}`,
            {
                headers: {
                    "X-API-Key": AGENTS_CONFIG_KEY || ""
                },
                timeout: 5000
            }
        );

        if (response.data?.success && response.data?.data) {
            return response.data.data;
        }
        
        logger.warn(`[A/B Test] Agent config ${agentConfigId} not found or invalid response`);
        return null;
    } catch (error) {
        logger.error(`[A/B Test] Error fetching agent config ${agentConfigId}:`, error.message);
        return null;
    }
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
 * Helper to fetch contact details (phone, name, address, email)
 */
async function fetchContactDetails(contactId, type) {
    if (type === "ESTABLISHMENT") {
        // Fetch from Geo DB - use 'name' field (same as frontend)
        const establishment = await prismaGeo.establishment.findUnique({
            where: { id: String(contactId) },
            select: { 
                phone: true, 
                name: true,  // This is what frontend uses: item.establishment?.name
                streetType: true,
                exteriorNum: true,
                municipalityName: true,
                stateName: true
            }
        });
        
        if (!establishment) return null;
        
        // Try to get enrichment data for email and decision maker name
        const enrichment = await prisma.establishmentEnrichment.findFirst({
            where: { establishmentId: contactId },
            select: { 
                decisionMakerEmail: true,
                decisionMakerName: true
            }
        });
        
        return {
            phone: establishment.phone,
            name: establishment.name || 'el establecimiento',
            decisionMakerName: enrichment?.decisionMakerName || null,
            email: enrichment?.decisionMakerEmail || null,
            address: [
                establishment.streetType,
                establishment.exteriorNum,
                establishment.municipalityName,
                establishment.stateName
            ].filter(Boolean).join(', ')
        };
    }
    // Handle 'LEAD' type if needed
    return null;
}

/**
 * Trigger calls for a running test (usando sistema de colas)
 */
async function triggerTestCalls(test) {
    const isSDR = test.agentType === "SDR";

    logger.info(`[A/B Test] Starting test ${test.id} - ${test.variants.length} variants`);
    logger.info(`[A/B Test] Encolando llamadas ${isSDR ? 'SDR' : 'QUALIFICATION'}...`);

    // Fetch all agent configs upfront to avoid repeated calls
    const agentConfigsMap = new Map();
    for (const variant of test.variants) {
        if (!agentConfigsMap.has(variant.agentConfigId)) {
            const config = await fetchAgentConfig(variant.agentConfigId);
            if (config) {
                agentConfigsMap.set(variant.agentConfigId, config);
                logger.info(`[A/B Test] Loaded config for variant: ${config.name}`);
            }
        }
    }

    let jobsEnqueued = 0;
    let jobsFailed = 0;

    for (const variant of test.variants) {
        const fullAgentConfig = agentConfigsMap.get(variant.agentConfigId);
        
        if (!fullAgentConfig) {
            logger.error(`[A/B Test] Skipping variant ${variant.id} - agent config ${variant.agentConfigId} not found`);
            continue;
        }
        
        for (const contact of variant.contacts) {
            if (contact.status !== "PENDING") continue;

            try {
                const contactDetails = await fetchContactDetails(contact.contactId, contact.contactType);

                if (!contactDetails || !contactDetails.phone) {
                    await updateCallResult(contact.contactId, variant.id, { status: "FAILED", result: "No phone number" });
                    jobsFailed++;
                    continue;
                }

                // Preparar datos para encolar
                const establishmentData = {
                    name: contactDetails.name && contactDetails.name !== 'el establecimiento' 
                        ? contactDetails.name 
                        : 'su negocio',
                    phone: contactDetails.phone,
                    address: contactDetails.address || "",
                    employeeRange: "6 a 10 personas", // Default, podría venir de contactDetails si lo agregas
                    agentConfigName: fullAgentConfig.name
                };

                const jobData = {
                    contactId: contact.contactId,
                    abTestContactId: contact.id,
                    agentConfigId: fullAgentConfig.id,
                    establishmentData
                };

                // Si es QUALIFICATION, agregar datos del tomador de decisiones
                if (!isSDR && (contactDetails.decisionMakerName || contactDetails.email)) {
                    jobData.decisionMakerData = {
                        name: contactDetails.decisionMakerName || "Contacto",
                        email: contactDetails.email || null
                    };
                }

                // Encolar job en lugar de llamar directamente
                if (isSDR) {
                    await enqueueSDRCall(jobData);
                    logger.info(`[A/B Test] Job SDR encolado para ${contact.contactId}`);
                } else {
                    await enqueueQualificationCall(jobData);
                    logger.info(`[A/B Test] Job QUALIFICATION encolado para ${contact.contactId}`);
                }

                jobsEnqueued++;

            } catch (e) {
                logger.error(`[A/B Test] Error encolando job para ${contact.contactId}:`, e.message);
                await updateCallResult(contact.contactId, variant.id, { status: "FAILED", result: e.message });
                jobsFailed++;
            }
        }
    }

    logger.info(`[A/B Test] Encolamiento completado: ${jobsEnqueued} jobs encolados, ${jobsFailed} fallidos`);
    logger.info(`[A/B Test] Los workers procesarán las llamadas asíncronamente`);
}

async function listTests(userId = null) {
    const whereClause = userId ? { createdBy: userId } : {};
    
    return await prisma.abTest.findMany({
        where: whereClause,
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
async function addCandidate(establishmentId, userId = null, snapshot = null) {
    // Check if exists
    const existing = await prisma.abTestCandidate.findUnique({
        where: { establishmentId }
    });

    if (existing) return existing;

    return await prisma.abTestCandidate.create({
        data: {
            establishmentId,
            userId,
            snapshotName: snapshot?.name || null,
            snapshotPhone: snapshot?.phone || null,
            snapshotUbicacion: snapshot?.ubicacion || null,
        }
    });
}

async function addCandidatesBulk(candidates, userId = null) {
    if (!candidates || candidates.length === 0) return { count: 0 };

    // candidates = [{ establishmentId, name?, phone?, ubicacion? }]
    return await prisma.abTestCandidate.createMany({
        data: candidates.map(c => ({
            establishmentId: c.establishmentId,
            userId,
            snapshotName: c.name || null,
            snapshotPhone: c.phone || null,
            snapshotUbicacion: c.ubicacion || null,
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
        if (e.code === 'P2025') return null; 
        throw e;
    }
}

async function getCandidates() {
    return await prisma.abTestCandidate.findMany({
        orderBy: { createdAt: 'desc' }
    });
}

async function getCandidatesByUser(userId) {
    return await prisma.abTestCandidate.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' }
    });
}

async function clearCandidatesByUser(userId) {
    return await prisma.abTestCandidate.deleteMany({
        where: { userId }
    });
}

async function getCandidatesWithSnapshot(userId) {
    return await prisma.abTestCandidate.findMany({
        where: userId ? { userId } : {},
        select: {
            id: true,
            establishmentId: true,
            userId: true,
            snapshotName: true,
            snapshotPhone: true,
            snapshotUbicacion: true,
            createdAt: true,
        },
        orderBy: { createdAt: 'desc' }
    });
}

async function clearCandidates() {
    return await prisma.abTestCandidate.deleteMany({});
}

/**
 * eliminateCandidateById
 * Elimina un candidato específico por su ID
 */
async function eliminateCandidateById(id) {
    try {
        return await prisma.abTestCandidate.delete({
            where: { id }
        });
    } catch (e) {
        if (e.code === 'P2025') {
            throw new Error('Candidate not found');
        }
        throw e;
    }
}

/**
 * getCandidatesWithDetails
 * Obtiene candidatos con detalles del establishment desde geo DB
 */
async function getCandidatesWithDetails(userId) {
    const candidates = await prisma.abTestCandidate.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' }
    });

    // Fetch establishment details from geo DB
    const enrichedCandidates = [];
    for (const candidate of candidates) {
        try {
            const establishment = await prismaGeo.establishment.findUnique({
                where: { id: candidate.establishmentId },
                select: {
                    id: true,
                    name: true,
                    address: true,
                    phone: true,
                    city: true,
                    state: true
                }
            });

            enrichedCandidates.push({
                ...candidate,
                establishment: establishment || null
            });
        } catch (e) {
            logger.error(`Error fetching establishment ${candidate.establishmentId}:`, e);
            enrichedCandidates.push({
                ...candidate,
                establishment: null
            });
        }
    }

    return enrichedCandidates;
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

async function pauseTest(id) {
    return await prisma.abTest.update({
        where: { id },
        data: {
            status: "PAUSED"
        }
    });
}

async function resumeTest(id) {
    const test = await prisma.abTest.update({
        where: { id },
        data: {
            status: "RUNNING"
        },
        include: {
            variants: {
                include: {
                    contacts: true
                }
            }
        }
    });

    // Re-encolar jobs pendientes si los hay
    triggerTestCalls(test).catch(err => {
        logger.error(`Error re-encolando llamadas del test ${id}:`, err);
    });

    return test;
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
    getCandidatesByUser,
    clearCandidates,
    clearCandidatesByUser,
    eliminateCandidateById,
    getCandidatesWithDetails,
    getCandidatesWithSnapshot,
    stopTest,
    pauseTest,
    resumeTest
};
