/**
 * Servicio de Monitoreo de Tests A/B
 * 
 * Proporciona monitoreo en tiempo real de la ejecución de tests A/B usando Server-Sent Events (SSE).
 * Transmite estadísticas de colas y progreso de tests a clientes conectados.
 * 
 * Características principales:
 * - Estadísticas de colas en tiempo real (trabajos pendientes, activos, completados, fallidos)
 * - Progreso de test por variante (tasas de finalización, tasas de éxito)
 * - Limpieza automática de conexiones obsoletas
 * - Intervalo de actualización configurable
 */

const prisma = require("../config/database");
const logger = require("../config/logger");
const { getSDRQueueStats } = require("../queues/sdrCallQueue");
const { getQualificationQueueStats } = require("../queues/qualificationCallQueue");

// Configuración
const SSE_UPDATE_INTERVAL_MS = 2000; // 2 segundos según requisitos
const SSE_KEEPALIVE_INTERVAL_MS = 30000; // 30 segundos keepalive
const SSE_MAX_CONNECTIONS = 50; // Límite de conexiones SSE concurrentes

// Registro de conexiones SSE activas
const activeConnections = new Map();

/**
 * Obtiene estadísticas agregadas de las colas
 */
async function getQueueStatistics() {
    try {
        const sdrStats = await getSDRQueueStats();
        const qualificationStats = await getQualificationQueueStats();
        
        return {
            sdr: sdrStats,
            qualification: qualificationStats,
            total: {
                waiting: sdrStats.waiting + qualificationStats.waiting,
                active: sdrStats.active + qualificationStats.active,
                completed: sdrStats.completed + qualificationStats.completed,
                failed: sdrStats.failed + qualificationStats.failed,
                delayed: sdrStats.delayed + qualificationStats.delayed
            }
        };
    } catch (error) {
        logger.error("[SSE Monitoring] Error getting queue statistics:", error);
        return null;
    }
}

/**
 * Obtiene detalles del progreso del test con desglose por variante
 */
async function getTestProgressDetails(testId) {
    try {
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

        if (!test) return null;

        // Obtener desglose de estado de contactos por variante
        const contactStats = await prisma.abTestContact.groupBy({
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

        // Mapear estadísticas a cada variante
        const variantsWithProgress = test.variants.map(variant => {
            const variantStats = contactStats.filter(s => s.abTestVariantId === variant.id);
            
            const totalAssigned = variant._count.contacts;
            const pending = variantStats.find(s => s.status === 'PENDING')?._count.id || 0;
            const called = variantStats.find(s => s.status === 'CALLED')?._count.id || 0;
            const completed = variantStats.find(s => s.status === 'COMPLETED')?._count.id || 0;
            const failed = variantStats.find(s => s.status === 'FAILED')?._count.id || 0;
            
            const totalProcessed = called + completed + failed;
            const progressPercentage = totalAssigned > 0 
                ? Math.round((totalProcessed / totalAssigned) * 100) 
                : 0;
            
            const successRate = totalProcessed > 0
                ? Math.round((completed / totalProcessed) * 100)
                : 0;

            return {
                variantId: variant.id,
                variantName: variant.agentConfigName,
                agentConfigId: variant.agentConfigId,
                voiceId: variant.voiceId,
                percentage: variant.percentage,
                totalAssigned,
                pending,
                called,
                completed,
                failed,
                totalProcessed,
                progressPercentage,
                successRate
            };
        });

        return {
            testId: test.id,
            testName: test.name,
            agentType: test.agentType,
            status: test.status,
            startDate: test.startDate,
            variants: variantsWithProgress,
            overall: {
                totalContacts: variantsWithProgress.reduce((sum, v) => sum + v.totalAssigned, 0),
                totalPending: variantsWithProgress.reduce((sum, v) => sum + v.pending, 0),
                totalProcessed: variantsWithProgress.reduce((sum, v) => sum + v.totalProcessed, 0),
                totalCompleted: variantsWithProgress.reduce((sum, v) => sum + v.completed, 0),
                totalFailed: variantsWithProgress.reduce((sum, v) => sum + v.failed, 0),
                overallProgress: variantsWithProgress[0]?.totalAssigned > 0
                    ? Math.round((variantsWithProgress.reduce((sum, v) => sum + v.totalProcessed, 0) / 
                       variantsWithProgress.reduce((sum, v) => sum + v.totalAssigned, 0)) * 100)
                    : 0
            }
        };
    } catch (error) {
        logger.error(`[SSE Monitoring] Error getting test progress for ${testId}:`, error);
        return null;
    }
}

/**
 * Formatea mensaje SSE
 */
function formatSSEMessage(eventType, data) {
    return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Inicia stream SSE para monitoreo de test
 * 
 * @param {Request} req - Objeto request de Express
 * @param {Response} res - Objeto response de Express
 * @param {string} testId - ID del test A/B a monitorear
 */
function startTestMonitoringStream(req, res, testId) {
    // Validar límite de conexiones
    if (activeConnections.size >= SSE_MAX_CONNECTIONS) {
        logger.warn(`[SSE Monitoring] Connection limit reached (${SSE_MAX_CONNECTIONS})`);
        res.status(503).json({ 
            success: false, 
            error: 'Too many active monitoring connections. Please try again later.' 
        });
        return;
    }

    // Configure SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no' // Deshabilitar buffering de nginx
    });

    const connectionId = `${testId}-${Date.now()}`;
    
    logger.info(`[SSE Monitoring] Client connected for test ${testId} (${connectionId})`);

    // Enviar confirmación de conexión inicial
    res.write(formatSSEMessage('connected', { testId, connectionId, timestamp: new Date() }));

    // Función de streaming
    const streamUpdate = async () => {
        try {
            const queueStats = await getQueueStatistics();
            const testProgress = await getTestProgressDetails(testId);

            if (!testProgress) {
                res.write(formatSSEMessage('error', { 
                    error: 'Test no encontrado',
                    testId 
                }));
                cleanup();
                return;
            }

            const updateData = {
                timestamp: new Date(),
                testId,
                queues: queueStats,
                test: testProgress
            };

            res.write(formatSSEMessage('update', updateData));

            // Verificar si el test está completado
            if (testProgress.status === 'COMPLETED' || testProgress.overall.totalPending === 0) {
                logger.info(`[SSE Monitoring] Test ${testId} monitoring complete`);
                res.write(formatSSEMessage('complete', { 
                    testId,
                    finalProgress: testProgress 
                }));
                cleanup();
            }
        } catch (error) {
            logger.error(`[SSE Monitoring] Error in stream update for ${testId}:`, error);
            res.write(formatSSEMessage('error', { 
                error: 'Error interno del servidor',
                message: error.message 
            }));
        }
    };

    // Configurar intervalos
    const updateInterval = setInterval(streamUpdate, SSE_UPDATE_INTERVAL_MS);
    
    const keepaliveInterval = setInterval(() => {
        res.write(': keepalive\n\n');
    }, SSE_KEEPALIVE_INTERVAL_MS);

    // Almacenar información de la conexión
    activeConnections.set(connectionId, {
        testId,
        updateInterval,
        keepaliveInterval,
        startedAt: new Date()
    });

    // Función de limpieza
    const cleanup = () => {
        clearInterval(updateInterval);
        clearInterval(keepaliveInterval);
        activeConnections.delete(connectionId);
        res.end();
        logger.info(`[SSE Monitoring] Client disconnected for test ${testId} (${connectionId})`);
    };

    // Manejar desconexión del cliente
    req.on('close', cleanup);
    req.on('error', cleanup);

    // Enviar primera actualización inmediatamente
    streamUpdate();
}

/**
 * Inicia stream SSE para monitoreo global de colas (todos los tests)
 * 
 * @param {Request} req - Objeto request de Express
 * @param {Response} res - Objeto response de Express
 */
function startGlobalQueueMonitoringStream(req, res) {
    // Validar límite de conexiones
    if (activeConnections.size >= SSE_MAX_CONNECTIONS) {
        logger.warn(`[SSE Monitoring] Connection limit reached (${SSE_MAX_CONNECTIONS})`);
        res.status(503).json({ 
            success: false, 
            error: 'Demasiadas conexiones de monitoreo activas. Por favor inténtalo de nuevo más tarde.' 
        });
        return;
    }

    // Configurar headers SSE
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });

    const connectionId = `global-${Date.now()}`;
    
    logger.info(`[SSE Monitoring] Client connected for global queue monitoring (${connectionId})`);

    // Enviar confirmación de conexión inicial
    res.write(formatSSEMessage('connected', { scope: 'global', connectionId, timestamp: new Date() }));

    // Función de streaming
    const streamUpdate = async () => {
        try {
            const queueStats = await getQueueStatistics();

            const updateData = {
                timestamp: new Date(),
                queues: queueStats
            };

            res.write(formatSSEMessage('update', updateData));
        } catch (error) {
            logger.error(`[SSE Monitoring] Error in global queue stream:`, error);
            res.write(formatSSEMessage('error', { 
                error: 'Error interno del servidor',
                message: error.message 
            }));
        }
    };

    // Configurar intervalos
    const updateInterval = setInterval(streamUpdate, SSE_UPDATE_INTERVAL_MS);
    
    const keepaliveInterval = setInterval(() => {
        res.write(': keepalive\n\n');
    }, SSE_KEEPALIVE_INTERVAL_MS);

    // Almacenar información de la conexión
    activeConnections.set(connectionId, {
        scope: 'global',
        updateInterval,
        keepaliveInterval,
        startedAt: new Date()
    });

    // Función de limpieza
    const cleanup = () => {
        clearInterval(updateInterval);
        clearInterval(keepaliveInterval);
        activeConnections.delete(connectionId);
        res.end();
        logger.info(`[SSE Monitoring] Client disconnected from global queue monitoring (${connectionId})`);
    };

    // Manejar desconexión del cliente
    req.on('close', cleanup);
    req.on('error', cleanup);

    // Enviar primera actualización inmediatamente
    streamUpdate();
}

/**
 * Obtiene información sobre las conexiones SSE activas
 */
function getActiveConnectionsInfo() {
    const connections = Array.from(activeConnections.entries()).map(([id, info]) => ({
        connectionId: id,
        testId: info.testId || info.scope,
        startedAt: info.startedAt,
        duration: Math.round((Date.now() - info.startedAt.getTime()) / 1000)
    }));

    return {
        total: activeConnections.size,
        max: SSE_MAX_CONNECTIONS,
        connections
    };
}

module.exports = {
    startTestMonitoringStream,
    startGlobalQueueMonitoringStream,
    getActiveConnectionsInfo,
    getQueueStatistics,
    getTestProgressDetails
};
