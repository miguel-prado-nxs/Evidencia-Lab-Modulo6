const abTestsService = require("../services/abTestsService");
const abTestsServiceExtended = require("../services/abTestsServiceExtended");
const logger = require("../config/logger");

exports.create = async (req, res) => {
    try {
        const userId = req.headers['x-sales-user-id'];
        
        const testData = {
            ...req.body,
            createdBy: userId || null
        };
        
        const test = await abTestsService.createTest(testData);
        res.status(201).json({ success: true, data: test });
    } catch (error) {
        logger.error("Error creating A/B Test:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getAll = async (req, res) => {
    try {
        const userId = req.query.userId || req.headers['x-sales-user-id'] || null;
        
        const tests = await abTestsService.listTests(userId);
        res.json({ success: true, data: tests });
    } catch (error) {
        logger.error("Error listing A/B Tests:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getProgress = async (req, res) => {
    try {
        const { id } = req.params;
        const progress = await abTestsService.getTestProgress(id);
        res.json({ success: true, data: progress });
    } catch (error) {
        logger.error(`Error getting progress for test ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.start = async (req, res) => {
    try {
        const { id } = req.params;
        const test = await abTestsService.startTest(id);
        res.json({ success: true, data: test });
    } catch (error) {
        logger.error(`Error starting test ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.stop = async (req, res) => {
    try {
        const { id } = req.params;
        const test = await abTestsService.stopTest(id);
        res.json({ success: true, data: test });
    } catch (error) {
        logger.error(`Error stopping test ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.updateResult = async (req, res) => {
    try {
        const { contactId, variantId, status, result } = req.body;
        
        if (!contactId || !variantId || !status) {
            return res.status(400).json({ 
                success: false, 
                error: 'contactId, variantId, and status are required' 
            });
        }
        
        await abTestsService.updateCallResult(contactId, variantId, {
            status,
            result
        });
        
        logger.info(`[A/B Test] Updated result for contact ${contactId}: ${status}`);
        res.json({ success: true });
    } catch (error) {
        logger.error(`Error updating A/B test result:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.addCandidate = async (req, res) => {
    try {
        const { establishmentId } = req.body;
        // Optional: Get userId from req.user if authenticated
        await abTestsService.addCandidate(establishmentId);
        res.json({ success: true, message: "Candidate added" });
    } catch (error) {
        logger.error("Error adding candidate:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.addCandidatesBulk = async (req, res) => {
    try {
        const { candidates, userId } = req.body;
        const result = await abTestsService.addCandidatesBulk(candidates, userId);
        res.json({ success: true, message: "Candidates added", count: result.count });
    } catch (error) {
        logger.error("Error adding candidates bulk:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.removeCandidate = async (req, res) => {
    try {
        const { establishmentId } = req.params;
        await abTestsService.removeCandidate(establishmentId);
        res.json({ success: true, message: "Candidate removed" });
    } catch (error) {
        logger.error("Error removing candidate:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getCandidates = async (req, res) => {
    try {
        const candidates = await abTestsService.getCandidates();
        // Return array of IDs to match what frontend expects
        res.json({ success: true, data: candidates.map(c => c.establishmentId) });
    } catch (error) {
        logger.error("Error getting candidates:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};
exports.getCandidatesByUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const candidates = await abTestsService.getCandidatesByUser(userId);
        res.json({ success: true, data: candidates.map(c => c.establishmentId) });
    } catch (error) {
        logger.error("Error getting candidates by user:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.clearCandidatesByUser = async (req, res) => {
    try {
        const { userId } = req.params;
        await abTestsService.clearCandidatesByUser(userId);
        res.json({ success: true, message: "Candidates cleared by user" });
    } catch (error) {
        logger.error("Error clearing candidates by user:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.clearCandidates = async (req, res) => {
    try {
        await abTestsService.clearCandidates();
        res.json({ success: true, message: "All candidates cleared" });
    } catch (error) {
        logger.error("Error clearing candidates:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// Extended metrics endpoints
exports.getMetrics = async (req, res) => {
    try {
        const { id } = req.params;
        const metrics = await abTestsServiceExtended.getMetricsByVariant(id);
        res.json({ success: true, data: metrics });
    } catch (error) {
        logger.error(`Error getting metrics for test ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getWinner = async (req, res) => {
    try {
        const { id } = req.params;
        const winner = await abTestsServiceExtended.getWinner(id);
        res.json({ success: true, data: winner });
    } catch (error) {
        logger.error(`Error determining winner for test ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getRetryContacts = async (req, res) => {
    try {
        const { id } = req.params;
        const { maxRetries = 3, retryDelayHours = 24 } = req.query;
        const contacts = await abTestsServiceExtended.getContactsForRetry(
            id,
            parseInt(maxRetries),
            parseInt(retryDelayHours)
        );
        res.json({ success: true, data: contacts, count: contacts.length });
    } catch (error) {
        logger.error(`Error getting retry contacts for test ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.logCallResult = async (req, res) => {
    try {
        const { callLogId } = req.params;
        const updates = req.body;

        const result = await abTestsServiceExtended.updateCallLog(callLogId, updates);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error(`Error logging call result for ${req.params.callLogId}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * GET /api/v1/ab-tests/agent-status/:agentConfigId
 * Obtiene si un agente está actualmente en uso en un test A/B activo
 */
exports.getAgentRunningStatus = async (req, res) => {
    try {
        const { agentConfigId } = req.params;
        const prisma = require("../config/database");

        // Buscar tests RUNNING que usen este agentConfigId
        const runningTests = await prisma.abTest.findMany({
            where: {
                status: "RUNNING",
                variants: {
                    some: {
                        agentConfigId: agentConfigId
                    }
                }
            },
            include: {
                variants: {
                    where: {
                        agentConfigId: agentConfigId
                    }
                }
            },
            orderBy: {
                startDate: 'desc'
            },
            take: 1 // Solo el más reciente
        });

        if (runningTests.length > 0) {
            const test = runningTests[0];
            res.json({
                success: true,
                data: {
                    isRunning: true,
                    testId: test.id,
                    testName: test.name,
                    testStatus: test.status,
                    startDate: test.startDate
                }
            });
        } else {
            res.json({
                success: true,
                data: {
                    isRunning: false
                }
            });
        }
    } catch (error) {
        logger.error(`Error getting agent running status for ${req.params.agentConfigId}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * POST /api/v1/ab-tests/agents-status/bulk
 * Obtiene el estado de múltiples agentes en una sola llamada (bulk)
 */
exports.getAgentsBulkRunningStatus = async (req, res) => {
    try {
        const { agentConfigIds } = req.body;

        if (!Array.isArray(agentConfigIds) || agentConfigIds.length === 0) {
            return res.status(400).json({
                success: false,
                error: "agentConfigIds debe ser un array no vacío"
            });
        }

        const prisma = require("../config/database");

        // Buscar todos los tests RUNNING que usen cualquiera de estos agentConfigIds
        const runningTests = await prisma.abTest.findMany({
            where: {
                status: "RUNNING",
                variants: {
                    some: {
                        agentConfigId: {
                            in: agentConfigIds
                        }
                    }
                }
            },
            include: {
                variants: {
                    where: {
                        agentConfigId: {
                            in: agentConfigIds
                        }
                    }
                }
            },
            orderBy: {
                startDate: 'desc'
            }
        });

        // Construir mapa de agentConfigId -> status
        const statusMap = {};

        // Procesar cada test y sus variantes
        runningTests.forEach(test => {
            test.variants.forEach(variant => {
                // Solo asignar si no existe o si este test es más reciente
                if (!statusMap[variant.agentConfigId]) {
                    statusMap[variant.agentConfigId] = {
                        isRunning: true,
                        testId: test.id,
                        testName: test.name,
                        testStatus: test.status,
                        startDate: test.startDate
                    };
                }
            });
        });

        // Para los agentes que no están en tests, agregar isRunning: false
        agentConfigIds.forEach(agentId => {
            if (!statusMap[agentId]) {
                statusMap[agentId] = {
                    isRunning: false
                };
            }
        });

        res.json({
            success: true,
            data: statusMap
        });
    } catch (error) {
        logger.error(`Error getting bulk agent running status:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * DELETE /api/v1/ab-tests/candidates/candidate/:id
 * Elimina un candidato específico por su ID
 */
exports.eliminateCandidateById = async (req, res) => {
    try {
        const { id } = req.params;
        await abTestsService.eliminateCandidateById(id);
        res.json({ success: true, message: "Candidate eliminated successfully" });
    } catch (error) {
        logger.error("Error eliminating candidate by ID:", error);
        if (error.message === 'Candidate not found') {
            res.status(404).json({ success: false, error: error.message });
        } else {
            res.status(500).json({ success: false, error: error.message });
        }
    }
};

/**
 * GET /api/v1/ab-tests/candidates/:userId/details
 * Obtiene candidatos con detalles del establishment
 */
exports.getCandidatesWithDetails = async (req, res) => {
    try {
        const { userId } = req.params;
        const candidates = await abTestsService.getCandidatesWithDetails(userId);
        res.json({ success: true, data: candidates });
    } catch (error) {
        logger.error("Error getting candidates with details:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getCandidatesWithSnapshot = async (req, res) => {
    try {
        const { userId } = req.params;
        const candidates = await abTestsService.getCandidatesWithSnapshot(userId);
        res.json({ success: true, data: candidates });
    } catch (error) {
        logger.error("Error getting candidates with snapshot:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};


