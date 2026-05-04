/**
 * ElevenLabs Webhook Controller
 * 
 * Recibe notificaciones de los servicios elevenlabs-calificacion y elevenlabs-sdr
 * cuando una llamada finaliza. Actualiza el estado del contacto A/B y el
 * enrichment del establecimiento.
 * 
 * Esto reemplaza el polling que hacían los workers anteriores.
 * 
 * Endpoints:
 * - POST /api/v1/webhooks/elevenlabs/call-completed
 */

const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const logger = require("../config/logger");
const config = require("../config/env");

const prisma = new PrismaClient();

/**
 * Mapeo de estados ElevenLabs → estados internos del A/B testing
 */
const STATUS_MAP = {
  completed: "COMPLETED",
  done: "COMPLETED",
  success: "COMPLETED",
  failed: "FAILED",
  error: "FAILED",
  no_answer: "FAILED",
  'no-answer': "FAILED",
  busy: "FAILED",
  voicemail: "FAILED",
  declined: "FAILED",
  timeout: "FAILED",
};

/**
 * Valida la firma del webhook de ElevenLabs (si está configurada)
 */
function validateWebhookSignature(req) {
  const secret = config.elevenlabs?.webhookSecret;
  if (!secret) {
    // Sin secret configurado, aceptar (útil en desarrollo)
    return true;
  }

  const signature = req.headers["x-elevenlabs-signature"] || req.headers["x-webhook-signature"];
  if (!signature) {
    return false;
  }

  try {
    const payload = JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch (error) {
    logger.error("[ElevenLabs Webhook] Error validando firma:", error.message);
    return false;
  }
}

/**
 * POST /api/v1/webhooks/elevenlabs/call-completed
 * 
 * Recibe notificación cuando una llamada de ElevenLabs finaliza.
 * Puede ser invocado por:
 * - elevenlabs-calificacion (via sus webhooks save-qualification-result / end-call)
 * - elevenlabs-sdr (via su webhook save-all-and-end-call)
 * - ElevenLabs directamente (post-call webhook si se configura)
 * 
 * Payload esperado:
 * {
 *   establishment_id: string,
 *   ab_test_contact_id?: string,
 *   conversation_id?: string,
 *   status: "completed" | "failed" | "no_answer" | etc,
 *   call_duration_seconds?: number,
 *   call_summary?: string,
 *   call_transcript?: string,
 *   recording_url?: string,
 *   qualification_result?: { budget, authority, need, timeline, overall_score, notes }
 * }
 */
async function handleCallCompleted(req, res) {
  try {
    // Validar firma en producción
    if (config.server.nodeEnv === "production") {
      if (!validateWebhookSignature(req)) {
        logger.warn("[ElevenLabs Webhook] Firma inválida", {
          ip: req.ip,
          path: req.path,
        });
        return res.status(401).json({ error: "Invalid signature" });
      }
    }

    const body = req.body;

    // Normalizar campos (aceptar snake_case y camelCase)
    const establishmentId = body.establishment_id || body.establishmentId;
    const abTestContactId = body.ab_test_contact_id || body.abTestContactId;
    const conversationId = body.conversation_id || body.conversationId;
    const status = body.status || body.call_status || "completed";
    const callDurationSeconds = body.call_duration_seconds || body.callDurationSeconds;
    const callSummary = body.call_summary || body.callSummary;
    const callTranscript = body.call_transcript || body.callTranscript;
    const recordingUrl = body.recording_url || body.recordingUrl;
    const qualificationResult = body.qualification_result || body.qualificationResult;

    logger.info("[ElevenLabs Webhook] Recibido call-completed", {
      establishmentId,
      abTestContactId,
      conversationId,
      status,
      duration: callDurationSeconds,
    });

    if (!establishmentId && !abTestContactId && !conversationId) {
      logger.warn("[ElevenLabs Webhook] No se puede identificar la llamada (sin IDs)");
      return res.status(400).json({ error: "Missing identification data (establishment_id, ab_test_contact_id, or conversation_id)" });
    }

    const mappedStatus = STATUS_MAP[status?.toLowerCase()] || STATUS_MAP[status] || "COMPLETED";

    // 1. Actualizar el contacto A/B Test si aplica
    if (abTestContactId) {
      try {
        const existingContact = await prisma.abTestContact.findUnique({
          where: { id: abTestContactId },
        });

        if (existingContact) {
          const resultData = {
            success: mappedStatus === "COMPLETED",
            status: mappedStatus.toLowerCase(),
            conversationId,
            callDuration: callDurationSeconds || null,
            callSummary: callSummary || null,
            timestamp: new Date().toISOString(),
          };

          // Si hay resultado de calificación, incluirlo
          if (qualificationResult) {
            resultData.qualificationResult = qualificationResult;
          }

          await prisma.abTestContact.update({
            where: { id: abTestContactId },
            data: {
              status: mappedStatus,
              result: JSON.stringify(resultData),
            },
          });

          logger.info("[ElevenLabs Webhook] abTestContact actualizado", {
            abTestContactId,
            status: mappedStatus,
          });
        } else {
          logger.warn("[ElevenLabs Webhook] abTestContact no encontrado", { abTestContactId });
        }
      } catch (error) {
        logger.error("[ElevenLabs Webhook] Error actualizando abTestContact", {
          abTestContactId,
          error: error.message,
        });
      }
    }

    // 2. Actualizar enrichment del establecimiento si aplica
    if (establishmentId) {
      try {
        const enrichment = await prisma.establishmentEnrichment.findUnique({
          where: { establishmentId },
        });

        if (enrichment) {
          const updateData = {
            updatedAt: new Date(),
          };

          // No pisar callStatus si el MCP del agente ya escribió un outcome
          // conversacional (INTERESTED, QUALIFIED, CLOSED_WON, etc.).
          // Lógica: Sobrescribir si:
          // 1. callStatus es null/pending/calling (pre-call)
          // 2. callStatus es "completed" PERO hay evidencia de conversación en JSON
          //    (el agente escribió datos, recuperar su outcome real)
          // Dejar "completed" huérfano sin datos (webhook sin conversación real)
          const preCallStates = new Set([null, undefined, "", "pending", "calling"]);
          const hasConversationEvidence =
            enrichment.establishmentData &&
            typeof enrichment.establishmentData === "object" &&
            Object.keys(enrichment.establishmentData).length > 0;
          const shouldUpdate =
            preCallStates.has(enrichment.callStatus) ||
            (enrichment.callStatus === "completed" && hasConversationEvidence);

          if (shouldUpdate) {
            updateData.callStatus = mappedStatus.toLowerCase();
          }

          if (callDurationSeconds) updateData.callDuration = callDurationSeconds;
          if (callTranscript) updateData.callTranscript = callTranscript;
          if (callSummary) updateData.callSummary = callSummary;
          if (recordingUrl) updateData.callRecordingUrl = recordingUrl;

          // Guardar scores de calificación si vienen
          if (qualificationResult) {
            if (qualificationResult.budget !== undefined) updateData.budgetScore = qualificationResult.budget;
            if (qualificationResult.authority !== undefined) updateData.authorityScore = qualificationResult.authority;
            if (qualificationResult.need !== undefined) updateData.needScore = qualificationResult.need;
            if (qualificationResult.timeline !== undefined) updateData.timelineScore = qualificationResult.timeline;
            if (qualificationResult.overall_score !== undefined) updateData.overallScore = qualificationResult.overall_score;
            if (qualificationResult.notes) updateData.qualificationNotes = qualificationResult.notes;
          }

          await prisma.establishmentEnrichment.update({
            where: { establishmentId },
            data: updateData,
          });

          logger.info("[ElevenLabs Webhook] Enrichment actualizado", {
            establishmentId,
            status: mappedStatus,
          });
        }
      } catch (error) {
        logger.error("[ElevenLabs Webhook] Error actualizando enrichment", {
          establishmentId,
          error: error.message,
        });
      }
    }

    return res.status(200).json({ received: true, status: mappedStatus });
  } catch (error) {
    logger.error("[ElevenLabs Webhook] Error general:", {
      error: error.message,
      stack: error.stack,
    });
    // Responder 200 para que el servicio no reintente indefinidamente
    return res.status(200).json({ received: true, error: error.message });
  }
}

/**
 * POST /api/v1/webhooks/elevenlabs/voicemail-detected
 *
 * Recibe notificación INMEDIATA cuando el MCP detecta voicemail.
 * Se dispara en segundos, no espera a que termine la llamada.
 *
 * Payload:
 * {
 *   establishment_id: string,
 *   conversation_id: string,
 *   status: "voicemail",
 *   detection_reason: string,
 *   timestamp: ISO8601
 * }
 */
async function handleVoicemailDetected(req, res) {
  try {
    const body = req.body;
    const establishmentId = body.establishment_id || body.establishmentId;
    const conversationId = body.conversation_id || body.conversationId;
    const detectionReason = body.detection_reason || body.detectionReason;

    logger.info("[Voicemail Webhook] Voicemail detectado", {
      establishmentId,
      conversationId,
      reason: detectionReason,
    });

    if (!establishmentId) {
      return res.status(400).json({ error: "Missing establishment_id" });
    }

    // Actualizar enrichment inmediatamente
    const enrichment = await prisma.establishmentEnrichment.findUnique({
      where: { establishmentId },
    });

    if (enrichment) {
      await prisma.establishmentEnrichment.update({
        where: { establishmentId },
        data: {
          callStatus: "voicemail",
          enrichmentStatus: "discovery_completed",
          callSummary: detectionReason || "Voicemail detectado automáticamente",
          updatedAt: new Date(),
        },
      });

      logger.info("[Voicemail Webhook] Enrichment actualizado", {
        establishmentId,
        status: "voicemail",
      });
    }

    return res.status(200).json({ received: true, status: "voicemail" });
  } catch (error) {
    logger.error("[Voicemail Webhook] Error:", {
      error: error.message,
      stack: error.stack,
    });
    return res.status(200).json({ received: true, error: error.message });
  }
}

/**
 * GET /api/v1/webhooks/elevenlabs/health
 * Health check del endpoint de webhooks
 */
async function webhookHealth(req, res) {
  res.json({
    status: "ok",
    service: "elevenlabs-webhooks",
    endpoints: [
      "POST /api/v1/webhooks/elevenlabs/call-completed",
      "POST /api/v1/webhooks/elevenlabs/voicemail-detected",
    ],
    timestamp: new Date().toISOString(),
  });
}

module.exports = {
  handleCallCompleted,
  handleVoicemailDetected,
  webhookHealth,
};
