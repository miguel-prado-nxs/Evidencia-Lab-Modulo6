/**
 * Worker de procesamiento de llamadas SDR (ElevenLabs).
 *
 * Este worker procesa trabajos de la cola "sdr-calls" y envía las llamadas
 * al servicio elevenlabs-sdr. Ya NO hace polling para detectar finalización —
 * el webhook de ElevenLabs notifica cuando la llamada termina.
 *
 * Flujo de procesamiento:
 * 1. Obtiene job de la cola
 * 2. Actualiza estado a CALLED en BD
 * 3. Envía POST a elevenlabs-sdr/api/sdr/initiate-call
 * 4. Actualiza estado a IN_PROGRESS con conversation_id
 * 5. Retorna (el webhook de ElevenLabs actualizará a COMPLETED/FAILED)
 *
 * Concurrencia: Configurable via env (default 8, max 20 por plan ElevenLabs Pro)
 * Reintentos: Configurados en Bull (3 intentos por defecto)
 */

const { sdrCallQueue } = require("../queues/sdrCallQueue");
const axios = require("axios");
const { PrismaClient } = require("@prisma/client");
const logger = require("../config/logger");
const config = require("../config/env");

const prisma = new PrismaClient();

// ElevenLabs SDR Agent
const AGENT_URL = config.agents.sdr.url;
const AGENT_API_KEY = config.agents.sdr.apiKey;
const CONCURRENCY = config.agents.sdrConcurrency;

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
      logger.warn("[SDR Worker] Contacto no encontrado en BD, omitiendo actualización", {
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

    logger.info("[SDR Worker] Estado actualizado", {
      abTestContactId,
      status,
    });
  } catch (error) {
    logger.error("[SDR Worker] Error actualizando estado", {
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
    logger.warn("[SDR Worker] Número con formato inesperado", { original: phone, cleaned: formatted });
    return `+52${formatted}`;
  }
}

/**
 * Ejecuta la llamada al servicio elevenlabs-sdr.
 * Ya NO hace polling — el webhook de ElevenLabs actualiza el estado final.
 */
async function executeSDRCall(jobData) {
  const {
    contactId,
    abTestContactId,
    agentConfigId,
    elevenLabsAgentId,
    voiceId,
    establishmentData,
  } = jobData;

  try {
    logger.info("[SDR Worker] Iniciando llamada ElevenLabs SDR", {
      abTestContactId,
      contactId,
      agentConfigId,
      elevenLabsAgentId: elevenLabsAgentId || config.agents.sdr.agentId || 'default',
      voiceId: voiceId
    });

    console.log(`[SDR Worker DEBUG] Job data voiceId: ${voiceId}`);

    // Actualizar estado a CALLED antes de ejecutar
    await updateContactStatus(abTestContactId, "CALLED", null, new Date());

    const formattedPhone = formatPhoneE164(establishmentData?.phone);

    // Payload para elevenlabs-sdr (formato que su POST /api/sdr/initiate-call espera)
    const payload = {
      establishment_id: contactId,
      establishment_name: establishmentData?.name || "Establecimiento",
      phone: formattedPhone,
      address: establishmentData?.address || "",
      employee_range: establishmentData?.employeeRange || "0 a 5 personas",
      prospect_name: jobData.decisionMakerData?.name || "Contacto",
      // Contexto A/B Testing
      ab_test_contact_id: abTestContactId,
      voice_id: voiceId,
      agent_name: jobData.agentName,
    };

    // Si hay un agent_config_id específico de ElevenLabs, pasarlo
    if (elevenLabsAgentId) {
      payload.agent_config_id = elevenLabsAgentId;
    }

    // Headers para elevenlabs-sdr
    const headers = {
      "Content-Type": "application/json",
    };
    if (AGENT_API_KEY) {
      headers["X-API-Key"] = AGENT_API_KEY;
    }

    // Ejecutar llamada al servicio elevenlabs-sdr
    const targetUrl = `${AGENT_URL}/api/sdr/initiate-call`;
    logger.info(`[SDR Worker] Enviando POST a: ${targetUrl}`, { payload });
    
    const response = await axios.post(
      targetUrl,
      payload,
      {
        headers,
        timeout: 30000, 
      }
    );

    const conversationId = response.data?.call_id || response.data?.conversation_id;
    const sessionId = response.data?.session_id;

    logger.info("[SDR Worker] Llamada SDR iniciada exitosamente via ElevenLabs", {
      abTestContactId,
      conversationId,
      sessionId,
    });

    // Actualizar estado a CALLED con info de tracking (webhook moverá a COMPLETED/FAILED)
    const result = {
      success: true,
      status: 'in_progress',
      conversationId,
      sessionId,
      timestamp: new Date().toISOString(),
    };

    await updateContactStatus(abTestContactId, "CALLED", result);

    // Delay antes de procesar siguiente llamada
    await delay(CALL_DELAY_MS);

    return result;
  } catch (error) {
    logger.error("[SDR Worker] Error en llamada ElevenLabs SDR", {
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
 * Procesador de trabajos de la cola SDR
 */
sdrCallQueue.process(
  "sdr-call",
  CONCURRENCY, // Concurrencia configurable (default 8)
  async (job) => {
    const { contactId, abTestContactId } = job.data;

    logger.info("[SDR Worker] Procesando job", {
      jobId: job.id,
      abTestContactId,
      attemptsMade: job.attemptsMade,
    });

    try {
      if (!contactId || !abTestContactId) {
        throw new Error("Faltan datos requeridos en el job (contactId, abTestContactId)");
      }

      const result = await executeSDRCall(job.data);

      logger.info("[SDR Worker] Job completado (llamada iniciada)", {
        jobId: job.id,
        abTestContactId,
        success: result.success,
      });

      return result;
    } catch (error) {
      logger.error("[SDR Worker] Job falló", {
        jobId: job.id,
        abTestContactId,
        attemptsMade: job.attemptsMade,
        error: error.message,
      });

      if (job.attemptsMade >= job.opts.attempts) {
        logger.error("[SDR Worker] Job falló definitivamente después de todos los reintentos", {
          jobId: job.id,
          abTestContactId,
        });
      }

      throw error;
    }
  }
);

// Eventos del worker
sdrCallQueue.on("error", (error) => {
  logger.error("[SDR Worker] Error general del worker:", { error: error.message });
});

sdrCallQueue.on("stalled", (job) => {
  logger.warn("[SDR Worker] Job estancado (posible crash)", {
    jobId: job.id,
    abTestContactId: job.data?.abTestContactId,
  });
});

logger.info(`[SDR Worker] Iniciado con concurrencia de ${CONCURRENCY} llamadas (ElevenLabs)`);

module.exports = { sdrCallQueue };
