/**
 * Backfill histórico de interacciones en Twenty CRM
 *
 * Recorre CampaignContact con conversationId no nulo y encola un job INTERACTION
 * por cada uno. La dedupeKey natural previene duplicados en re-ejecuciones.
 *
 * Uso:
 *   node prisma/scripts/backfill-interactions.js            # ejecución real
 *   node prisma/scripts/backfill-interactions.js --dry-run  # solo reporta volumen
 */

require('dotenv').config();

const prisma = require('../../src/config/database');
const { enqueueInteractionSync } = require('../../src/services/twenty/twentyActivityService');

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 50;
const DELAY_MS = 200;

// Solo campañas reales — excluye tests y pruebas
const REAL_CAMPAIGN_NAMES = ['Queen Elizabeth The First', 'Queen Elizabeth The Second'];

// Mapeo de CampaignType a stage de STAGE_CONFIG
const STAGE_BY_CAMPAIGN_TYPE = {
  DISCOVERY: 'discovery',
  QUALIFICATION: 'qualification',
  ACTIVATION: 'activation',
  CONVERSION: 'conversion',
};

// Mapeo de ContactStatus a outcome
const OUTCOME_BY_STATUS = {
  CALLED: 'COMPLETED',
  RESPONDED: 'COMPLETED',
  CONVERTED: 'COMPLETED',
  VISITED: 'COMPLETED',
  DELIVERED: 'COMPLETED',
  FAILED: 'FAILED',
  PENDING: 'NO_ANSWER',
  SCHEDULED: 'NO_ANSWER',
  PAUSED: 'NO_ANSWER',
  CALLING: 'NO_ANSWER',
  SENT: 'NO_ANSWER',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  console.log(`[backfill-interactions] Modo: ${DRY_RUN ? 'DRY-RUN' : 'REAL'}`);

  const campaignFilter = {
    conversationId: { not: null },
    campaign: { name: { in: REAL_CAMPAIGN_NAMES } },
  };

  const total = await prisma.campaignContact.count({
    where: campaignFilter,
  });

  console.log(`[backfill-interactions] Contactos con conversationId: ${total}`);

  let enqueued = 0;
  let skippedDuplicate = 0;
  let skippedNoEstablishment = 0;
  let skippedNoStage = 0;
  let offset = 0;

  while (offset < total) {
    const batch = await prisma.campaignContact.findMany({
      where: campaignFilter,
      include: { campaign: { select: { type: true, name: true } } },
      skip: offset,
      take: BATCH_SIZE,
      orderBy: { createdAt: 'asc' },
    });

    for (const contact of batch) {
      const { id, conversationId, establishmentId, status, callDuration, campaignId, campaign } =
        contact;

      if (!establishmentId) {
        console.log(`[backfill-interactions] Sin establecimiento — omitiendo ${id}`);
        skippedNoEstablishment++;
        continue;
      }

      const stage = STAGE_BY_CAMPAIGN_TYPE[campaign?.type];
      if (!stage) {
        console.log(
          `[backfill-interactions] Tipo de campaña desconocido (${campaign?.type}) — omitiendo ${id}`
        );
        skippedNoStage++;
        continue;
      }

      const outcome = OUTCOME_BY_STATUS[status] || 'NO_ANSWER';

      if (DRY_RUN) {
        console.log(
          `[backfill-interactions] [DRY-RUN] ${conversationId} | ${stage} | ${outcome} | est:${establishmentId}`
        );
        enqueued++;
        continue;
      }

      // enqueueInteractionSync retorna null en duplicado (P2002) — no lanza
      const jobId = await enqueueInteractionSync({
        establishmentId,
        conversationId,
        stage,
        outcome,
        callSummary: null,
        callDuration: callDuration || null,
        campaignId,
        campaignName: campaign?.name || null,
      });

      if (jobId) {
        enqueued++;
      } else {
        skippedDuplicate++;
      }
    }

    offset += batch.length;
    console.log(`[backfill-interactions] Progreso: ${Math.min(offset, total)}/${total}`);

    if (offset < total) await sleep(DELAY_MS);
  }

  console.log('\n[backfill-interactions] ===== REPORTE FINAL =====');
  console.log(`  Encoladas:               ${enqueued}`);
  console.log(`  Saltadas (duplicado):    ${skippedDuplicate}`);
  console.log(`  Saltadas (sin estab.):   ${skippedNoEstablishment}`);
  console.log(`  Saltadas (sin stage):    ${skippedNoStage}`);
  console.log(`  Total procesadas:        ${total}`);
  console.log(`  Modo:                    ${DRY_RUN ? 'DRY-RUN — nada fue encolado' : 'REAL'}`);

  await prisma.$disconnect();
}

run().catch((err) => {
  console.error('[backfill-interactions] Error fatal:', err.message);
  prisma.$disconnect();
  process.exit(1);
});
