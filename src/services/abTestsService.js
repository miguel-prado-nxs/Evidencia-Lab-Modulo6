const prisma = require("../config/database");
const prismaGeo = require("../config/database-geo");
const logger = require("../config/logger");
const axios = require("axios");
const { enqueueSDRCall, enqueueQualificationCall } = require("../queues");

/**
 * createTest
 * Creates a new A/B Test, distributes contacts among variants, and saves to DB.
 * 
 * Con ElevenLabs, cada variante tiene un agentConfigId que es el Agent ID de ElevenLabs.
 * Ya no se buscan personalidades en demo-form-service.
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

    // Validate all variants have valid voiceId
    for (const variant of variants) {
        if (!variant.voiceId || variant.voiceId === 'elevenlabs') {
            throw new Error(`Variant must have a valid voiceId. Received: ${variant.voiceId || 'empty'}`);
        }
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
            // Usar personalityId desde el frontend si está disponible
            let personalityId = variant.personalityId || null;

            // Si no viene personalityId, buscar por voiceId (fallback)
            if (!personalityId && variant.voiceId) {
                const personality = await tx.elevenLabsPersonality.findFirst({
                    where: { voiceId: variant.voiceId }
                });
                personalityId = personality?.id || null;
            }

            const v = await tx.abTestVariant.create({
                data: {
                    abTestId: abTest.id,
                    personalityId, // ID de elevenlabs_personalities
                    agentConfigId: variant.agentConfigId,
                    voiceId: variant.voiceId,
                    voiceName: variant.voiceName || null,
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
 * fetchAgentConfig (DEPRECATED - ElevenLabs)
 * 
 * Con ElevenLabs, las personalidades están configuradas directamente en el
 * panel de ElevenLabs. El agentConfigId ahora ES el ElevenLabs Agent ID.
 * Ya no se necesita consultar demo-form-service para obtener configs.
 * 
 * Se mantiene como stub por compatibilidad con código que pueda llamarla,
 * retornando un objeto mínimo con el ID pasado.
 */
async function fetchAgentConfig(agentConfigId) {
    logger.info(`[A/B Test] fetchAgentConfig llamado con ${agentConfigId} (ElevenLabs - no se consulta demo-form-service)`);
    return {
        id: agentConfigId,
        name: `ElevenLabs Agent ${agentConfigId}`,
        type: 'elevenlabs',
    };
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
                    contacts: true,
                    personality: true
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
 * Trigger calls for a running test (usando sistema de colas).
 * 
 * Con ElevenLabs, ya NO se necesita fetchAgentConfig del demo-form-service.
 * El agentConfigId de cada variante ES el ElevenLabs Agent ID directamente.
 * Las personalidades están configuradas en el panel de ElevenLabs.
 */
async function triggerTestCalls(test) {
    const isSDR = test.agentType === "SDR";

    logger.info(`[A/B Test] Starting test ${test.id} - ${test.variants.length} variants (ElevenLabs)`);
    logger.info(`[A/B Test] Encolando llamadas ${isSDR ? 'SDR' : 'QUALIFICATION'} via ElevenLabs...`);

    let jobsEnqueued = 0;
    let jobsFailed = 0;

    for (const variant of test.variants) {
        // Con ElevenLabs, agentConfigId es directamente el ElevenLabs Agent ID
        const elevenLabsAgentId = variant.agentConfigId;

        logger.info(`[A/B Test] Variante ${variant.id}: Agent ID ElevenLabs = ${elevenLabsAgentId}`);

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
                    // agentConfigName ya no se usa aquí
                };

                logger.info(`[A/B Test DEBUG] Processing variant ${variant.id} for A/B testing with voice from DB`);

                // Obtener voice_id desde elevenlabs_personalities si está linkeado
                let voiceId = variant.voiceId; // Fallback al voiceId directo
                let agentName = variant.voiceName || "Agente";

                if (variant.personality) {
                    // Usar voz desde la tabla elevenlabs_personalities
                    voiceId = variant.personality.voiceId;
                    agentName = variant.personality.name || agentName;
                    logger.info(`[A/B Test] Using voice from DB: ${agentName} (${voiceId})`);
                }

                // Validar que voiceId no esté vacío o sea 'elevenlabs' (placeholder)
                if (!voiceId || voiceId === 'elevenlabs') {
                    logger.error(`[A/B Test] Variant ${variant.id} has no valid voiceId. Skipping call for contact ${contact.contactId}`);
                    await updateCallResult(contact.contactId, variant.id, {
                        status: "FAILED",
                        result: "Voz no configurada en la variante"
                    });
                    jobsFailed++;
                    continue;
                }

                const jobData = {
                    contactId: contact.contactId,
                    abTestContactId: contact.id,
                    agentConfigId: elevenLabsAgentId, // ElevenLabs Agent ID
                    elevenLabsAgentId, // Explicit para los workers
                    voiceId, // Voice ID desde elevenlabs_personalities
                    skipVoiceOverride: false, // Aplicar override con la voz de BD
                    agentName, // Nombre del agente desde elevenlabs_personalities
                    establishmentData,
                };

                logger.info(`[A/B Test DEBUG] final jobData for ${contact.id}: ${JSON.stringify({ ...jobData, establishmentData: undefined })}`);
                // Agregar datos del tomador de decisiones si existen (necesario para personalización)
                if (contactDetails.decisionMakerName || contactDetails.email) {
                    jobData.decisionMakerData = {
                        name: contactDetails.decisionMakerName || "Contacto",
                        email: contactDetails.email || null,
                    };
                }

                // Encolar job
                if (isSDR) {
                    await enqueueSDRCall(jobData);
                    logger.info(`[A/B Test] Job SDR encolado para ${contact.contactId} (Agent: ${elevenLabsAgentId})`);
                } else {
                    await enqueueQualificationCall(jobData);
                    logger.info(`[A/B Test] Job QUALIFICATION encolado para ${contact.contactId} (Agent: ${elevenLabsAgentId})`);
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
    logger.info(`[A/B Test] Los workers procesarán las llamadas asíncronamente via ElevenLabs`);
}

async function listTests(userId = null) {
    const whereClause = userId ? { createdBy: userId } : {};

    return await prisma.abTest.findMany({
        where: whereClause,
        include: {
            variants: {
                include: {
                    personality: true // Incluir la personalidad vinculada
                }
            },
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
                    contacts: true,
                    personality: true
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

/**
 * Reconcile stalled contacts: find contacts stuck in CALLED status for too long
 * and mark them as COMPLETED. This handles the case where the ElevenLabs webhook
 * (save_all_and_end_call) never fires due to session collision or call issues.
 * 
 * Runs periodically (every 3 minutes) and checks contacts stuck for > 5 minutes.
 */
async function reconcileStalledContacts() {
    const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
    const cutoffDate = new Date(Date.now() - STALE_THRESHOLD_MS);

    try {
        // Find contacts stuck in CALLED status for more than 5 minutes
        const stalledContacts = await prisma.abTestContact.findMany({
            where: {
                status: 'CALLED',
                calledAt: {
                    lt: cutoffDate  // calledAt is more than 5 minutes ago
                }
            },
            include: {
                variant: {
                    include: {
                        abTest: { select: { id: true, status: true } }
                    }
                }
            }
        });

        if (stalledContacts.length === 0) return;

        logger.info(`[Reconciliation] Found ${stalledContacts.length} stalled contacts (CALLED > 5 min)`);

        for (const contact of stalledContacts) {
            // Only reconcile contacts from RUNNING tests
            if (contact.variant?.abTest?.status !== 'RUNNING') continue;

            // Parse existing result to get conversationId if available
            let existingResult = {};
            try {
                if (contact.result) {
                    existingResult = JSON.parse(contact.result);
                }
            } catch (_) { }

            const result = {
                ...existingResult,
                status: 'completed',
                reconciled: true,
                reconciledAt: new Date().toISOString(),
                note: 'Auto-completed by reconciliation (webhook did not fire within 5 minutes)'
            };

            await prisma.abTestContact.update({
                where: { id: contact.id },
                data: {
                    status: 'COMPLETED',
                    result: JSON.stringify(result)
                }
            });

            logger.info(`[Reconciliation] Auto-completed contact ${contact.contactId} (abTestContact: ${contact.id})`);
        }

        // Check if any test is now fully completed
        const testIds = [...new Set(stalledContacts.map(c => c.variant?.abTest?.id).filter(Boolean))];
        for (const testId of testIds) {
            // Use a more direct query to avoid complex subqueries that might fail in some DB setups
            const variants = await prisma.abTestVariant.findMany({
                where: { abTestId: testId },
                select: { id: true }
            });
            const variantIds = variants.map(v => v.id);

            const pendingCount = await prisma.abTestContact.count({
                where: {
                    abTestVariantId: { in: variantIds },
                    status: { in: ['PENDING', 'CALLED'] }
                }
            });

            if (pendingCount === 0) {
                await prisma.abTest.update({
                    where: { id: testId },
                    data: { status: 'COMPLETED', endDate: new Date() }
                });
                logger.info(`[Reconciliation] Test ${testId} marked as COMPLETED (all contacts resolved)`);
            }
        }
    } catch (error) {
        logger.error('[Reconciliation] Error reconciling stalled contacts:', error.message);
    }
}

// Start periodic reconciliation (every 3 minutes)
setInterval(reconcileStalledContacts, 3 * 60 * 1000);
logger.info('[Reconciliation] Periodic stalled contact reconciliation started (every 3 min)');

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
    resumeTest,
    reconcileStalledContacts
};

