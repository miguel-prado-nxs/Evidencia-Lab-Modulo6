/**
 * SDR Service
 * Servicios para el Agente SDR de identificación de tomadores de decisiones
 * 
 * El SDR Agent desde agentes-crm-sdk llama a estos endpoints para:
 * - Guardar resultados de llamadas
 * - Actualizar información del tomador de decisiones
 * - Registrar interacciones con gatekeepers
 */

const prisma = require("../config/database");
const prismaGeo = require("../config/database-geo");
const logger = require("../config/logger");
const enrichmentService = require("./enrichmentService");

/**
 * Guardar resultado de llamada SDR
 * Actualiza el enriquecimiento del establecimiento con info del tomador de decisiones
 * 
 * @param {string} establishmentId - ID del establecimiento en Mapa DB
 * @param {Object} data - Datos de la llamada
 * @returns {Object} - Enriquecimiento actualizado
 */
async function saveCallResult(establishmentId, data) {
    try {
        const {
            decisionMaker,
            enrichmentStatus,
            callSummary,
            gatekeeperInfo,
            strategy,
            callAttempts,
            callDurationSeconds,
            callStatus,
        } = data;

        // Preparar datos de enriquecimiento
        const enrichmentData = {};

        // Datos del tomador de decisiones
        if (decisionMaker) {
            if (decisionMaker.name) {
                enrichmentData.decisionMakerName = decisionMaker.name;
            }
            if (decisionMaker.position) {
                enrichmentData.decisionMakerPosition = decisionMaker.position;
            }
            if (decisionMaker.phone) {
                enrichmentData.decisionMakerPhone = decisionMaker.phone;
            }
            if (decisionMaker.whatsapp) {
                enrichmentData.decisionMakerWhatsApp = decisionMaker.whatsapp;
            }
            if (decisionMaker.email) {
                enrichmentData.decisionMakerEmail = decisionMaker.email;
            }
        }

        // Usar el enrichmentService existente para crear/actualizar
        // Nota: partnerId es null porque es el agente SDR, no un partner específico
        const enrichment = await enrichmentService.createOrUpdateEnrichment(
            establishmentId,
            enrichmentData,
            null // Sin partnerId específico - es el agente SDR
        );

        // Registrar la interacción SDR como metadatos adicionales
        await logSDRInteraction(establishmentId, {
            callStatus,
            enrichmentStatus,
            callSummary,
            gatekeeperInfo,
            strategy,
            callAttempts,
            callDurationSeconds,
            timestamp: new Date(),
        });

        logger.info(`SDR call result saved for establishment ${establishmentId}`, {
            status: enrichmentStatus,
            decisionMakerIdentified: !!decisionMaker?.name,
            strategy,
        });

        return enrichment;
    } catch (error) {
        logger.error("Error saving SDR call result:", error);
        throw error;
    }
}

/**
 * Registrar interacción SDR
 * Guarda en sdr_interactions y actualiza campos en establishment_enrichments
 * 
 * @param {string} establishmentId - ID del establecimiento
 * @param {Object} interactionData - Datos de la interacción
 */
async function logSDRInteraction(establishmentId, interactionData) {
    const sdrInteractionsService = require("./sdrInteractionsService");

    try {
        const {
            callStatus,
            enrichmentStatus,
            callSummary,
            gatekeeperInfo,
            strategy,
            callAttempts,
            callDurationSeconds,
            decisionMaker,
            twilioCallSid,
        } = interactionData;

        // 1. Contar intentos previos para este establecimiento
        const previousAttempts = await sdrInteractionsService.countAttempts(establishmentId);
        const attemptNumber = previousAttempts + 1;

        // 2. Guardar en sdr_interactions (historial completo)
        await sdrInteractionsService.createInteraction({
            establishmentId,
            callStatus,
            enrichmentStatus,
            decisionMakerFound: !!decisionMaker?.name,
            decisionMakerName: decisionMaker?.name || null,
            decisionMakerRole: decisionMaker?.position || null,
            callSummary,
            callDurationSeconds,
            attemptNumber,
            strategy,
            gatekeeperInfo,
            twilioCallSid,
        });

        // 3. Actualizar campos agregados en establishment_enrichments
        await prisma.establishmentEnrichment.updateMany({
            where: { establishmentId },
            data: {
                callAttempts: attemptNumber,
                callDurationSeconds: callDurationSeconds || 0,
                callStatus,
                enrichmentStatus,
                strategy,
                gatekeeperInfo,
                callSummary,
            },
        });

        logger.info(`SDR Interaction logged for ${establishmentId}`, {
            attemptNumber,
            callStatus,
            enrichmentStatus,
            decisionMakerFound: !!decisionMaker?.name,
        });

        return true;
    } catch (error) {
        logger.error("Error logging SDR interaction:", error);
        // No lanzar error - el logging no debe bloquear el flujo principal
        return false;
    }
}

/**
 * Obtener establecimiento para contexto del agente SDR
 * Devuelve datos necesarios para que el agente sepa cómo manejar la llamada
 * 
 * @param {string} establishmentId - ID del establecimiento
 * @returns {Object} - Datos del establecimiento con contexto SDR
 */
async function getEstablishmentForCall(establishmentId) {
    try {
        // Obtener establecimiento de Mapa DB
        const establishment = await prismaGeo.establishment.findUnique({
            where: { id: establishmentId },
            select: {
                id: true,
                name: true,
                phone: true,
                email: true,
                website: true,
                activityName: true,
                employeeRange: true,
                stateName: true,
                municipalityName: true,
                neighborhood: true,
            },
        });

        if (!establishment) {
            throw new Error("Establecimiento no encontrado");
        }

        // Obtener enriquecimiento existente si hay
        const enrichment = await prisma.establishmentEnrichment.findUnique({
            where: { establishmentId },
        });

        // Determinar estrategia recomendada basada en tamaño
        const recommendedStrategy = getRecommendedStrategy(establishment.employeeRange);

        return {
            establishment,
            enrichment: enrichment || null,
            sdrContext: {
                recommendedStrategy,
                hasExistingDecisionMaker: !!enrichment?.decisionMakerName,
                previousAttempts: 0, // TODO: obtener de sdr_interactions
            },
        };
    } catch (error) {
        logger.error("Error getting establishment for SDR call:", error);
        throw error;
    }
}

/**
 * Determinar estrategia recomendada basada en tamaño del negocio
 * - Estrategia A: Directo con valor (negocios pequeños 0-5 empleados)
 * - Estrategia B: Referencia interna (negocios grandes 6+ empleados)
 */
function getRecommendedStrategy(employeeRange) {
    const smallBusiness = ["0 a 5 personas"];

    if (smallBusiness.includes(employeeRange)) {
        return "A";
    }

    return "B";
}

/**
 * Obtener estadísticas de SDR
 * Para dashboard de métricas A/B
 */
async function getSDRStats() {
    try {
        // Contar establecimientos con tomador identificado
        const identified = await prisma.establishmentEnrichment.count({
            where: {
                decisionMakerName: { not: null },
            },
        });

        // Contar por nivel PROSPECT (tienen tomador + teléfono)
        const prospects = await prisma.establishmentEnrichment.count({
            where: {
                level: "PROSPECT",
            },
        });

        return {
            totalIdentified: identified,
            totalProspects: prospects,
            // TODO: Agregar métricas por estrategia cuando tengamos sdr_interactions
        };
    } catch (error) {
        logger.error("Error getting SDR stats:", error);
        throw error;
    }
}


/**
 * Obtener información de llamadas SDR para un establecimiento
 * @param {string} establishmentId - ID del establecimiento
 * @returns {Object} - Información de las llamadas SDR
 */
async function getSDRCallInfo(establishmentId) {
  try {
    // Obtener interacciones SDR desde la tabla sdr_interactions
    const sdrInteractions = await prisma.sdrInteraction.findMany({
      where: { establishmentId },
      orderBy: { createdAt: "desc" },
    });

    // Si no hay interacciones, retornar null
    if (!sdrInteractions || sdrInteractions.length === 0) {
      return null;
    }

    // Obtener la última interacción (la más reciente)
    const lastInteraction = sdrInteractions[0];

    // Calcular estadísticas
    const totalAttempts = sdrInteractions.length;
    const successfulCalls = sdrInteractions.filter(i => i.decisionMakerFound).length;
    const totalDuration = sdrInteractions.reduce((sum, i) => sum + (i.callDurationSeconds || 0), 0);

    return {
      // Datos de la última llamada
      lastCall: {
        enrichmentStatus: lastInteraction.enrichmentStatus,
        decisionMakerFound: lastInteraction.decisionMakerFound,
        decisionMakerName: lastInteraction.decisionMakerName,
        decisionMakerRole: lastInteraction.decisionMakerRole,
        callSummary: lastInteraction.callSummary,
        attemptNumber: lastInteraction.attemptNumber,
        callStatus: lastInteraction.callStatus,
        callDurationSeconds: lastInteraction.callDurationSeconds,
        strategy: lastInteraction.strategy,
        createdAt: lastInteraction.createdAt,
      },
      // Estadísticas generales
      stats: {
        totalAttempts,
        successfulCalls,
        totalDuration,
        lastCallDate: lastInteraction.createdAt,
      },
      // Historial completo
      history: sdrInteractions.map(i => ({
        id: i.id,
        callStatus: i.callStatus,
        enrichmentStatus: i.enrichmentStatus,
        decisionMakerFound: i.decisionMakerFound,
        decisionMakerName: i.decisionMakerName,
        attemptNumber: i.attemptNumber,
        callDurationSeconds: i.callDurationSeconds,
        strategy: i.strategy,
        createdAt: i.createdAt,
      })),
    };
  } catch (error) {
    logger.error("[VentasEnrichment] Error obteniendo info de llamadas SDR:", error);
    throw error;
  }
}


/**
 * Obtener información de llamadas de calificación (call_leads) para un prospecto
 * @param {string} establishmentId - ID del establecimiento
 * @returns {Object|null} - Información agregada de llamadas o null si no hay
 */
async function getLeadCallInfo(establishmentId) {
  try {
    // Obtener todas las llamadas para este establecimiento, ordenadas por fecha
    const calls = await prisma.callLead.findMany({
      where: { establishmentId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        callStatus: true,
        callSummary: true,
        intent: true,
        fear: true,
        pain: true,
        desire: true,
        nextAction: true,
        qualificationScore: true,
        intentScore: true,
        bookingMethod: true,
        scheduledAt: true,
        callDurationSeconds: true,
        createdAt: true,
        fullName: true,
        phone: true,
        email: true,
      },
    });

    if (!calls || calls.length === 0) {
      return null;
    }

    // Última llamada
    const lastCall = calls[0];

    // Estadísticas
    const stats = {
      totalCalls: calls.length,
      completedCalls: calls.filter((c) => c.callStatus === "completed").length,
      totalDuration: calls.reduce((sum, c) => sum + (c.callDurationSeconds || 0), 0),
      averageScore: calls.filter((c) => c.intentScore).length > 0
        ? Math.round(
            calls
              .filter((c) => c.intentScore)
              .reduce((sum, c) => sum + c.intentScore, 0) / 
            calls.filter((c) => c.intentScore).length
          )
        : null,
    };

    // Historial (todas las llamadas)
    const history = calls.map((call) => ({
      id: call.id,
      callStatus: call.callStatus,
      qualificationScore: call.qualificationScore,
      intentScore: call.intentScore,
      nextAction: call.nextAction,
      scheduledAt: call.scheduledAt,
      createdAt: call.createdAt,
    }));

    return {
      lastCall: {
        callStatus: lastCall.callStatus,
        callSummary: lastCall.callSummary,
        intent: lastCall.intent,
        fear: lastCall.fear,
        pain: lastCall.pain,
        desire: lastCall.desire,
        nextAction: lastCall.nextAction,
        qualificationScore: lastCall.qualificationScore,
        intentScore: lastCall.intentScore,
        bookingMethod: lastCall.bookingMethod,
        scheduledAt: lastCall.scheduledAt,
        callDurationSeconds: lastCall.callDurationSeconds,
        createdAt: lastCall.createdAt,
        fullName: lastCall.fullName,
        phone: lastCall.phone,
        email: lastCall.email,
      },
      stats,
      history,
    };
  } catch (error) {
    logger.error("[VentasEnrichment] Error obteniendo info de llamadas de leads:", error);
    throw error;
  }
}

module.exports = {
    saveCallResult,
    logSDRInteraction,
    getEstablishmentForCall,
    getRecommendedStrategy,
    getSDRStats,
    getSDRCallInfo,
    getLeadCallInfo,
};
