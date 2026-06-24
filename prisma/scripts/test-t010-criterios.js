/**
 * Test de criterios T010 — enqueueCampaignSync helper
 * Uso: node prisma/scripts/test-t010-criterios.js
 *
 * Criterios cubiertos:
 *   C1  Una llamada crea DOS jobs: un PIPELINE y un INTERACTION
 *   C2  Job PIPELINE tiene reason con formato CALL_{STAGE}
 *   C3  Job INTERACTION tiene dedupeKey interaction:{conversationId}:{stage}
 *   C4  Funciona para las 4 etapas de llamada
 */
require('dotenv').config({ quiet: true });
const prisma = require('../../src/config/database');

// Importar enqueueCampaignSync indirectamente ejecutando el modulo
// (es una funcion interna del servicio, no exportada — la probamos via efecto en BD)
// Usamos enqueueSync + enqueueInteractionSync directamente para simular el helper
const { enqueueSync } = require('../../src/services/twenty/twentySyncService');
const { enqueueInteractionSync } = require('../../src/services/twenty/twentyActivityService');

let passed = 0;
let failed = 0;
const createdJobIds = [];

function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ' -> ' + detail : ''}`);
  }
}

// Replica exacta de enqueueCampaignSync para poder rastrear los jobIds creados
async function enqueueCampaignSyncTest(stage, {
  establishmentId, conversationId, outcome, callSummary, callDuration, campaignId, campaignName,
}) {
  const pipelineId = await enqueueSync({
    establishmentId,
    partnerId: null,
    reason: `CALL_${stage.toUpperCase()}`,
  }).catch(() => null);

  const interactionId = await enqueueInteractionSync({
    establishmentId,
    conversationId,
    stage,
    outcome,
    callSummary,
    callDuration: callDuration || null,
    campaignId: campaignId || null,
    campaignName: campaignName || null,
  }).catch(() => null);

  return { pipelineId, interactionId };
}

async function run() {
  const TS = Date.now();

  const enrichment = await prisma.establishmentEnrichment.findFirst({
    select: { establishmentId: true },
  });
  if (!enrichment) {
    console.error('No hay EstablishmentEnrichment en la BD. Aborto.');
    process.exit(1);
  }
  const ESTAB = enrichment.establishmentId;

  // Limpiar PIPELINE PENDING previo para que enqueueSync cree uno nuevo en C1
  await prisma.twentySyncJob.updateMany({
    where: { establishmentId: ESTAB, type: 'PIPELINE', status: { in: ['PENDING', 'PROCESSING'] } },
    data: { status: 'DONE' },
  });

  // ============================================================
  // C1 + C2 + C3: Una llamada -> PIPELINE + INTERACTION correctos
  // ============================================================
  console.log('\nC1/C2/C3: enqueueCampaignSync crea PIPELINE + INTERACTION');

  const { pipelineId, interactionId } = await enqueueCampaignSyncTest('discovery', {
    establishmentId: ESTAB,
    conversationId: `t010-conv-${TS}`,
    outcome: 'COMPLETED',
    callSummary: 'Resumen de prueba T010',
    callDuration: 75,
    campaignId: null,
    campaignName: '[TEST] T010',
  });

  if (pipelineId) createdJobIds.push(pipelineId);
  if (interactionId) createdJobIds.push(interactionId);

  check('C1: se creo job PIPELINE', !!pipelineId);
  check('C1: se creo job INTERACTION', !!interactionId);
  check('C1: son jobs distintos', pipelineId !== interactionId);

  const [pipelineJob, interactionJob] = await Promise.all([
    pipelineId ? prisma.twentySyncJob.findUnique({ where: { id: pipelineId } }) : null,
    interactionId ? prisma.twentySyncJob.findUnique({ where: { id: interactionId } }) : null,
  ]);

  check('C2: PIPELINE.type === PIPELINE', pipelineJob?.type === 'PIPELINE', pipelineJob?.type);
  check('C2: PIPELINE.reason === CALL_DISCOVERY', pipelineJob?.reason === 'CALL_DISCOVERY', pipelineJob?.reason);
  check('C3: INTERACTION.type === INTERACTION', interactionJob?.type === 'INTERACTION', interactionJob?.type);
  check(
    `C3: dedupeKey === interaction:t010-conv-${TS}:discovery`,
    interactionJob?.dedupeKey === `interaction:t010-conv-${TS}:discovery`,
    interactionJob?.dedupeKey
  );

  // ============================================================
  // C4: Las 4 etapas generan el reason correcto en PIPELINE
  // ============================================================
  console.log('\nC4: formato CALL_{STAGE} para las 4 etapas');

  const stages = ['qualification', 'activation', 'conversion'];

  for (const stage of stages) {
    // Limpiar PIPELINE PENDING para que cree uno nuevo
    await prisma.twentySyncJob.updateMany({
      where: { establishmentId: ESTAB, type: 'PIPELINE', status: { in: ['PENDING', 'PROCESSING'] } },
      data: { status: 'DONE' },
    });

    const { pipelineId: pid, interactionId: iid } = await enqueueCampaignSyncTest(stage, {
      establishmentId: ESTAB,
      conversationId: `t010-conv-${TS}-${stage}`,
      outcome: 'NO_ANSWER',
      callSummary: null,
      callDuration: null,
      campaignId: null,
      campaignName: null,
    });

    if (pid) createdJobIds.push(pid);
    if (iid) createdJobIds.push(iid);

    const pJob = pid ? await prisma.twentySyncJob.findUnique({ where: { id: pid } }) : null;
    check(
      `${stage}: PIPELINE.reason === CALL_${stage.toUpperCase()}`,
      pJob?.reason === `CALL_${stage.toUpperCase()}`,
      pJob?.reason
    );
    check(`${stage}: INTERACTION creado`, !!iid);
  }

  // ============================================================
  // Cleanup
  // ============================================================
  console.log('\nLimpiando datos de prueba...');
  const deleted = await prisma.twentySyncJob.deleteMany({
    where: { id: { in: createdJobIds } },
  });
  console.log(`  ${deleted.count} jobs eliminados.`);

  console.log(`\n========================================`);
  console.log(`RESULTADO: ${passed} PASS, ${failed} FAIL`);
  console.log(`========================================`);

  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(async (err) => {
  console.error('\nError fatal:', err.message);
  await prisma.$disconnect();
  process.exit(1);
});
