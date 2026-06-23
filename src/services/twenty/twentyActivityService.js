/**
 * Twenty Activity Service
 * Encola y procesa jobs tipo INTERACTION — genera Notes en Twenty CRM
 * por cada llamada de campaña o envio/redención de cupon.
 *
 * Flujo:
 *   funnelWebhookService -> enqueueInteractionSync -> TwentySyncJob (INTERACTION)
 *   twentySyncWorker -> processInteractionJob -> createNote + createNoteTarget
 */

const prisma = require('../../config/database');
const logger = require('../../config/logger');
const twentyService = require('./twentyService');

// Outcomes que no implican conversacion real — sin resumen, maxAttempts=5
const NON_CONVERSATIONAL = new Set(['NO_ANSWER', 'VOICEMAIL', 'WRONG_NUMBER', 'FAILED']);

// Labels compartidos por las 4 etapas de llamada
const CALL_OUTCOME_LABELS = {
  COMPLETED: 'Contacto realizado',
  FOLLOW_UP_LATER: 'Seguimiento posterior',
  FOLLOW_UP: 'Seguimiento requerido',
  FOLLOW_UP_NEEDED: 'Seguimiento requerido',
  ADVANCE_TO_ACTIVATION: 'Avanzar a activacion',
  CLOSED_WON: 'Venta cerrada',
  OBJECTION_UNRESOLVED: 'Objecion sin resolver',
  NOT_INTERESTED: 'No interesado',
  DISQUALIFIED: 'Descalificado',
  LOST: 'Perdido',
  WRONG_NUMBER: 'Numero equivocado',
  NO_ANSWER: 'Sin respuesta',
  VOICEMAIL: 'Buzon de voz',
  FAILED: 'Fallo tecnico',
};

/**
 * Configuracion por etapa: label, si hubo conversacion real, y textos de resultado.
 * isConversational determina si el resumen de llamada tiene contenido util y
 * si vale la pena reintentar indefinidamente (null maxAttempts) o solo 5 veces.
 */
const STAGE_CONFIG = {
  discovery: {
    stageLabel: 'Discovery',
    isConversational: (outcome) => !NON_CONVERSATIONAL.has(outcome),
    outcomeLabels: CALL_OUTCOME_LABELS,
  },
  qualification: {
    stageLabel: 'Qualification',
    isConversational: (outcome) => !NON_CONVERSATIONAL.has(outcome),
    outcomeLabels: CALL_OUTCOME_LABELS,
  },
  activation: {
    stageLabel: 'Activation',
    isConversational: (outcome) => !NON_CONVERSATIONAL.has(outcome),
    outcomeLabels: CALL_OUTCOME_LABELS,
  },
  conversion: {
    stageLabel: 'Conversion',
    isConversational: (outcome) => !NON_CONVERSATIONAL.has(outcome),
    outcomeLabels: CALL_OUTCOME_LABELS,
  },
  coupon_sent: {
    stageLabel: 'Cupon',
    isConversational: () => false,
    outcomeLabels: {
      SENT: 'Cupon enviado por WhatsApp',
    },
  },
  coupon_redeemed: {
    stageLabel: 'Cupon',
    isConversational: () => false,
    outcomeLabels: {
      REDEEMED: 'Cupon redimido',
    },
  },
};

/**
 * Formatea duracion de llamada en texto legible.
 * @param {number|null} seconds
 * @returns {string}
 */
function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return 'No disponible';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

/**
 * Construye el cuerpo markdown de la Note.
 * El resumen de llamada solo se incluye cuando hubo conversacion real.
 *
 * @param {Object} params
 * @returns {string}
 */
function buildNoteMarkdown({
  stageLabel,
  outcomeLabel,
  isConversational,
  conversationId,
  campaignName,
  callDuration,
  callSummary,
}) {
  const lines = [
    `**Campana**: ${campaignName || 'Sin nombre'}`,
    `**Etapa**: ${stageLabel}`,
    `**Resultado**: ${outcomeLabel}`,
    `**ID conversacion**: \`${conversationId}\``,
  ];

  if (isConversational) {
    lines.push(`**Duracion**: ${formatDuration(callDuration)}`);
  }

  if (isConversational && callSummary) {
    lines.push('');
    lines.push('### Resumen');
    lines.push(callSummary);
  }

  return lines.join('\n');
}

/**
 * Encola un job INTERACTION para crear una Note en Twenty.
 * Non-blocking: errores son loggeados y absorbidos para no afectar el flujo principal.
 *
 * @param {Object} params
 * @param {string} params.establishmentId - UUID del establecimiento en Partners BD
 * @param {string} params.conversationId - ID unico de la conversacion (ElevenLabs)
 * @param {string} params.stage - Etapa (discovery|qualification|activation|conversion|coupon_sent|coupon_redeemed)
 * @param {string} params.outcome - Resultado (COMPLETED|NO_ANSWER|VOICEMAIL|FAILED|SENT|REDEEMED)
 * @param {string|null} params.callSummary - Resumen generado por el agente
 * @param {number|null} params.callDuration - Duracion en segundos
 * @param {string|null} params.campaignId - ID de la campaña
 * @param {string|null} params.campaignName - Nombre de la campaña (para el body)
 * @returns {Promise<string|null>} jobId o null si se omitio
 */
async function enqueueInteractionSync({
  establishmentId,
  conversationId,
  stage,
  outcome,
  callSummary,
  callDuration,
  campaignId,
  campaignName,
}) {
  if (!twentyService.isEnabled()) {
    logger.debug('[TwentyActivityService:enqueueInteractionSync] Sync deshabilitado');
    return null;
  }

  const stageConfig = STAGE_CONFIG[stage];
  if (!stageConfig) {
    logger.warn('[TwentyActivityService:enqueueInteractionSync] Etapa desconocida', { stage });
    return null;
  }

  // Dedupe por conversacion+etapa: la misma llamada no genera dos Notes
  const dedupeKey = `interaction:${conversationId}:${stage}`;

  // Si hubo conversacion real, reintentar indefinidamente (null); si no, maximo 5 veces
  const maxAttempts = stageConfig.isConversational(outcome) ? null : 5;

  try {
    const job = await prisma.twentySyncJob.create({
      data: {
        establishmentId,
        type: 'INTERACTION',
        status: 'PENDING',
        reason: `${stage}:${outcome}`,
        dedupeKey,
        maxAttempts,
        payload: {
          conversationId,
          stage,
          outcome,
          callSummary,
          callDuration,
          campaignId,
          campaignName,
        },
        nextRunAt: new Date(),
      },
    });

    logger.info('[TwentyActivityService:enqueueInteractionSync] Job INTERACTION encolado', {
      jobId: job.id,
      establishmentId,
      stage,
      outcome,
      dedupeKey,
    });

    return job.id;
  } catch (error) {
    // P2002 = unique constraint: job ya existe para esta conversacion+etapa — skip silencioso
    if (error.code === 'P2002') {
      logger.debug('[TwentyActivityService:enqueueInteractionSync] Job duplicado omitido', {
        dedupeKey,
        establishmentId,
      });
      return null;
    }

    logger.error(
      '[TwentyActivityService:enqueueInteractionSync] Error encolando job (no critico)',
      {
        error: error.message,
        establishmentId,
        stage,
        outcome,
      }
    );
    return null;
  }
}

/**
 * Procesa un job INTERACTION: crea Note en Twenty y la ancla al Company del establecimiento.
 * Lanza error si falla — el worker decide reintentar segun maxAttempts.
 *
 * @param {Object} job - TwentySyncJob con type=INTERACTION
 */
async function processInteractionJob(job) {
  const { establishmentId, payload } = job;
  const { conversationId, stage, outcome, callSummary, callDuration, campaignName } = payload || {};

  logger.info('[TwentyActivityService:processInteractionJob] Procesando job', {
    jobId: job.id,
    establishmentId,
    stage,
    outcome,
  });

  // 1. Resolver el ID del Company en Twenty
  const syncState = await prisma.twentySyncState.findUnique({
    where: { establishmentId },
    select: { twentyEstablecimientoId: true },
  });

  const twentyCompanyId = syncState?.twentyEstablecimientoId;

  if (!twentyCompanyId) {
    // El establecimiento aun no esta en Twenty — el pipeline PIPELINE sync lo creara despues
    throw new Error(
      `Establecimiento sin twentyEstablecimientoId: ${establishmentId}. Esperar sync de pipeline.`
    );
  }

  // 2. Resolver config de la etapa y textos
  const stageConfig = STAGE_CONFIG[stage];
  if (!stageConfig) {
    throw new Error(`Etapa no reconocida en STAGE_CONFIG: ${stage}`);
  }

  const outcomeLabel = stageConfig.outcomeLabels[outcome] || outcome;
  const isConversational = stageConfig.isConversational(outcome);

  // 3. Construir titulo y cuerpo de la Note
  const noteTitle = `[${stageConfig.stageLabel}] ${outcomeLabel}`;
  const noteBody = buildNoteMarkdown({
    stageLabel: stageConfig.stageLabel,
    outcomeLabel,
    isConversational,
    conversationId,
    campaignName,
    callDuration,
    callSummary,
  });

  // 4. Crear Note en Twenty
  const note = await twentyService.createNote(noteTitle, noteBody);

  // 5. Anclar Note al Company del establecimiento
  await twentyService.createNoteTarget(note.id, { companyId: twentyCompanyId });

  logger.info('[TwentyActivityService:processInteractionJob] Note creada y anclada', {
    jobId: job.id,
    noteId: note.id,
    twentyCompanyId,
    stage,
    outcome,
  });
}

module.exports = {
  STAGE_CONFIG,
  enqueueInteractionSync,
  processInteractionJob,
};
