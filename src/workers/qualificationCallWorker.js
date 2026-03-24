/**
 * Worker de procesamiento de llamadas de Calificación (ElevenLabs).
 *
 * Este worker procesa trabajos de la cola "qualification-calls" y envía
 * las llamadas al servicio elevenlabs-calificacion. Ya NO hace polling
 * para detectar finalización — el webhook de ElevenLabs notifica cuando
 * la llamada termina y actualiza el estado del contacto A/B directamente.
 *
 * Flujo de procesamiento:
 * 1. Obtiene job de la cola
 * 2. Actualiza estado a CALLED en BD
 * 3. Envía POST a elevenlabs-calificacion/api/qualification/initiate-call
 * 4. Actualiza estado a IN_PROGRESS con conversation_id
 * 5. Retorna (el webhook de ElevenLabs actualizará a COMPLETED/FAILED)
 *
 * Concurrencia: Configurable via env (default 10, max 20 por plan ElevenLabs Pro)
 * Reintentos: Configurados en Bull (3 intentos por defecto)
 */

const { qualificationCallQueue } = require("../queues/qualificationCallQueue");
const axios = require("axios");
const { PrismaClient } = require("@prisma/client");
const logger = require("../config/logger");
const config = require("../config/env");

const prisma = new PrismaClient();

// ElevenLabs Qualification Agent
const AGENT_URL = config.agents.qualification.url;
const AGENT_API_KEY = config.agents.qualification.apiKey;
const CONCURRENCY = config.agents.qualificationConcurrency;

// Delay mínimo entre procesamiento de jobs (2 segundos)
const CALL_DELAY_MS = 2000;

/**
 * Función auxiliar para introducir un delay
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Actualiza el estado de un contacto en el test A/B
 */
async function updateContactStatus(abTestContactId, status, result = null, calledAt = null) {
  try {
    const existingContact = await prisma.abTestContact.findUnique({
      where: { id: abTestContactId },
    });

    if (!existingContact) {
      logger.warn("[Qualification Worker] Contacto no encontrado en BD, omitiendo actualización", {
        abTestContactId,
        status,
      });
      return;
    }

    const updateData = {
      status,
      result: result ? JSON.stringify(result) : null,
    };

    if (calledAt) {
      updateData.calledAt = calledAt;
    }

    await prisma.abTestContact.update({
      where: { id: abTestContactId },
      data: updateData,
    });

    logger.info("[Qualification Worker] Estado actualizado", {
      abTestContactId,
      status,
    });
  } catch (error) {
    logger.error("[Qualification Worker] Error actualizando estado", {
      abTestContactId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Formatea número de teléfono a formato E.164 (México)
 */
function formatPhoneE164(phone) {
  let formatted = (phone || "").replace(/[\s\-\(\)\.]/g, '');

  if (formatted.startsWith('+52')) {
    return formatted;
  } else if (formatted.startsWith('52') && formatted.length === 12) {
    return `+${formatted}`;
  } else if (formatted.length === 10 && /^\d{10}$/.test(formatted)) {
    return `+52${formatted}`;
  } else {
    logger.warn("[Qualification Worker] Número con formato inesperado", { original: phone, cleaned: formatted });
    return `+52${formatted}`;
  }
}

/**
 * Ejecuta la llamada al servicio elevenlabs-calificacion.
 * Ya NO hace polling — el webhook de ElevenLabs actualiza el estado final.
 */
async function executeQualificationCall(jobData) {
  const {
    contactId,
    abTestContactId,
    agentConfigId,
    elevenLabsAgentId,
    voiceId,
    skipVoiceOverride,
    establishmentData,
    decisionMakerData,
  } = jobData;

  try {
    logger.info("[Qualification Worker] Iniciando llamada ElevenLabs Calificación", {
      abTestContactId,
      contactId,
      agentConfigId,
      elevenLabsAgentId: elevenLabsAgentId || config.agents.qualification.agentId || 'default',
    });

    // Actualizar estado a CALLED antes de ejecutar
    await updateContactStatus(abTestContactId, "CALLED", null, new Date());

    logger.info(`[Qualification Worker DEBUG] agentName from jobData: ${jobData.agentName}`);

    const formattedPhone = formatPhoneE164(establishmentData?.phone);

    // Payload para elevenlabs-calificacion (formato que su POST /api/qualification/initiate-call espera)
    const payload = {
      establishment_id: contactId,
      business_name: establishmentData?.name || "Establecimiento",
      phone: formattedPhone,
      prospect_name: decisionMakerData?.name || "Contacto",
      email: decisionMakerData?.email || null,
      // Contexto A/B Testing — elevenlabs-calificacion lo pasa como dynamic variable
      ab_test_contact_id: abTestContactId,
      agent_config_id: elevenLabsAgentId,
    };

    // Siempre incluir agent_name si está disponible
    // En A/B (skipVoiceOverride=true): usa nombre del frontend, voz de branch
    // En flujos normales: usa nombre de Agent Builder, voz override
    if (jobData.agentName) {
      payload.agent_name = jobData.agentName;
    }

    // Solo incluir voice_id si NO es A/B testing con branches (skipVoiceOverride)
    // Flujos normales (Auto-Enrich/Qualify) siguen usando voice override
    if (!skipVoiceOverride && voiceId) {
      payload.voice_id = voiceId;
    }

    // Pasar flag explícito para que el servicio downstream sepa si debe aplicar override
    if (skipVoiceOverride) {
      payload.skip_voice_override = true;
    }

    // Headers para elevenlabs-calificacion
    const headers = {
      "Content-Type": "application/json",
    };
    if (AGENT_API_KEY) {
      headers["X-API-Key"] = AGENT_API_KEY;
    }

    // Ejecutar llamada al servicio elevenlabs-calificacion
    const response = await axios.post(
      `${AGENT_URL}/api/qualification/initiate-call`,
      payload,
      {
        headers,
        timeout: 30000, // 30s timeout para iniciar la llamada (ya no esperamos que termine)
      }
    );

    const conversationId = response.data?.data?.conversation_id || response.data?.conversation_id;
    const callSid = response.data?.data?.call_sid || response.data?.call_sid;

    logger.info("[Qualification Worker] Llamada iniciada exitosamente via ElevenLabs", {
      abTestContactId,
      conversationId,
      callSid,
    });

    // Actualizar estado a IN_PROGRESS (el webhook de ElevenLabs lo moverá a COMPLETED/FAILED)
    const result = {
      success: true,
      status: 'in_progress',
      conversationId,
      callSid,
      timestamp: new Date().toISOString(),
    };

    await updateContactStatus(abTestContactId, "CALLED", result);

    // Delay antes de procesar siguiente llamada
    await delay(CALL_DELAY_MS);

    return result;
  } catch (error) {
    logger.error("[Qualification Worker] Error en llamada ElevenLabs Calificación", {
      abTestContactId,
      error: error.message,
      response: error.response?.data,
    });

    const result = {
      success: false,
      error: error.message,
      errorCode: error.response?.status,
      errorData: error.response?.data,
      timestamp: new Date().toISOString(),
    };

    await updateContactStatus(abTestContactId, "FAILED", result);

    throw error; // Re-lanzar para que Bull maneje el retry
  }
}

/**
 * Procesador de trabajos de la cola de Calificación
 */
qualificationCallQueue.process(
  "qualification-call",
  CONCURRENCY, // Concurrencia configurable (default 10)
  async (job) => {
    const {
      contactId,
      abTestContactId,
      agentConfigId,
    } = job.data;

    logger.info("[Qualification Worker] Procesando job", {
      jobId: job.id,
      abTestContactId,
      attemptsMade: job.attemptsMade,
    });

    try {
      if (!contactId || !abTestContactId) {
        throw new Error("Faltan datos requeridos en el job (contactId, abTestContactId)");
      }

      const result = await executeQualificationCall(job.data);

      logger.info("[Qualification Worker] Job completado (llamada iniciada)", {
        jobId: job.id,
        abTestContactId,
        success: result.success,
      });

      return result;
    } catch (error) {
      logger.error("[Qualification Worker] Job falló", {
        jobId: job.id,
        abTestContactId,
        attemptsMade: job.attemptsMade,
        error: error.message,
      });

      if (job.attemptsMade >= job.opts.attempts) {
        logger.error(
          "[Qualification Worker] Job falló definitivamente después de todos los reintentos",
          { jobId: job.id, abTestContactId }
        );
      }

      throw error;
    }
  }
);

// Eventos del worker
qualificationCallQueue.on("error", (error) => {
  logger.error("[Qualification Worker] Error general del worker:", {
    error: error.message,
  });
});

qualificationCallQueue.on("stalled", (job) => {
  logger.warn("[Qualification Worker] Job estancado (posible crash)", {
    jobId: job.id,
    abTestContactId: job.data?.abTestContactId,
  });
});

logger.info(`[Qualification Worker] Iniciado con concurrencia de ${CONCURRENCY} llamadas (ElevenLabs)`);

module.exports = { qualificationCallQueue };
