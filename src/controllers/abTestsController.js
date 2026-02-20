const abTestsService = require("../services/abTestsService");
const abTestsServiceExtended = require("../services/abTestsServiceExtended");
const abTestMonitoringService = require("../services/abTestMonitoringService");
const logger = require("../config/logger");
const { getSDRQueueStats } = require("../queues/sdrCallQueue");
const { getQualificationQueueStats } = require("../queues/qualificationCallQueue");
const { sdrCallQueue } = require("../queues/sdrCallQueue");
const { qualificationCallQueue } = require("../queues/qualificationCallQueue");

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
        const progress = await abTestMonitoringService.getTestProgressDetails(id);
        if (!progress) {
            return res.status(404).json({ success: false, error: 'Test not found' });
        }
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

// Queue monitoring endpoints
exports.getQueueStats = async (req, res) => {
    try {
        const sdrStats = await getSDRQueueStats();
        const qualificationStats = await getQualificationQueueStats();
        
        res.json({
            success: true,
            data: {
                sdr: sdrStats,
                qualification: qualificationStats,
                totalPending: sdrStats.waiting + qualificationStats.waiting,
                totalActive: sdrStats.active + qualificationStats.active,
                totalCompleted: sdrStats.completed + qualificationStats.completed,
                totalFailed: sdrStats.failed + qualificationStats.failed
            }
        });
    } catch (error) {
        logger.error("Error getting queue stats:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.pauseTest = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Pausar las colas temporalmente
        await sdrCallQueue.pause();
        await qualificationCallQueue.pause();
        
        // Actualizar estado del test a PAUSED
        const test = await abTestsService.pauseTest(id);
        
        logger.info(`[A/B Test] Test ${id} pausado`);
        res.json({ 
            success: true, 
            data: test,
            message: "Test pausado. Las llamadas en progreso terminarán, pero no se procesarán nuevas." 
        });
    } catch (error) {
        logger.error(`Error pausing test ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.resumeTest = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Reanudar las colas
        await sdrCallQueue.resume();
        await qualificationCallQueue.resume();
        
        // Actualizar estado del test a RUNNING
        const test = await abTestsService.resumeTest(id);
        
        logger.info(`[A/B Test] Test ${id} reanudado`);
        res.json({ 
            success: true, 
            data: test,
            message: "Test reanudado. Los workers continuarán procesando las llamadas pendientes." 
        });
    } catch (error) {
        logger.error(`Error resuming test ${req.params.id}:`, error);
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

/**
 * GET /api/v1/ab-tests/:id/monitor-stream
 * Stream de monitoreo en tiempo real usando Server-Sent Events (SSE)
 * 
 * Transmite progreso del test y estadísticas de colas cada 2 segundos.
 * La conexión se cierra automáticamente cuando el test completa o el cliente se desconecta.
 * 
 * Tipos de eventos:
 * - 'connected': Confirmación de conexión inicial
 * - 'update': Actualizaciones periódicas con estadísticas de colas y progreso del test
 * - 'complete': Ejecución del test finalizada
 * - 'error': Ocurrió un error durante el streaming
 * 
 * Formato de respuesta: text/event-stream
 */
exports.streamTestMonitoring = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Validar que el test existe antes de iniciar el stream
        const prisma = require("../config/database");
        const test = await prisma.abTest.findUnique({
            where: { id },
            select: { id: true, name: true, status: true }
        });

        if (!test) {
            return res.status(404).json({ 
                success: false, 
                error: 'Test no encontrado' 
            });
        }

        logger.info(`[SSE] Starting monitoring stream for test ${id} (${test.name})`);
        
        // Iniciar stream SSE (maneja la respuesta internamente)
        abTestMonitoringService.startTestMonitoringStream(req, res, id);
        
    } catch (error) {
        logger.error(`Error starting monitoring stream for test ${req.params.id}:`, error);
        
        // Solo enviar respuesta de error si los headers no se han enviado aún
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
};

/**
 * GET /api/v1/ab-tests/queues/monitor-stream
 * Stream de monitoreo global de colas usando Server-Sent Events (SSE)
 * 
 * Transmite estadísticas de colas para todos los tests cada 2 segundos.
 * Útil para monitorear la carga general del sistema y salud de las colas.
 * 
 * Tipos de eventos:
 * - 'connected': Confirmación de conexión inicial
 * - 'update': Actualizaciones periódicas de estadísticas de colas
 * - 'error': Ocurrió un error durante el streaming
 * 
 * Formato de respuesta: text/event-stream
 */
exports.streamGlobalQueueMonitoring = async (req, res) => {
    try {
        logger.info('[SSE] Starting global queue monitoring stream');
        
        // Iniciar stream SSE para monitoreo global de colas
        abTestMonitoringService.startGlobalQueueMonitoringStream(req, res);
        
    } catch (error) {
        logger.error('Error starting global queue monitoring stream:', error);
        
        // Solo enviar respuesta de error si los headers no se han enviado aún
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
};

/**
 * GET /api/v1/ab-tests/monitoring/connections
 * Obtiene información sobre las conexiones SSE de monitoreo activas
 * 
 * Útil para depuración y monitoreo de capacidad.
 */
exports.getActiveMonitoringConnections = async (req, res) => {
    try {
        const info = abTestMonitoringService.getActiveConnectionsInfo();
        res.json({ success: true, data: info });
    } catch (error) {
        logger.error('Error getting active connections info:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};


