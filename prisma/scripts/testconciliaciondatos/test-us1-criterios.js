/**
 * Test US1 — Historial de interacciones: hooks en end*Call
 * Uso: node prisma/scripts/testconciliaciondatos/test-us1-criterios.js
 *
 * Cubre T010, T011, T012, T013, T014:
 *   T010  enqueueCampaignSync: crea PIPELINE + INTERACTION por llamada
 *   T011  endDiscoveryCall: hook non-blocking, job INTERACTION en BD, no interrumpe si falla
 *   T012  endQualificationCall: hook non-blocking, job INTERACTION en BD
 *   T013  endActivationCall: hook non-blocking, job INTERACTION en BD
 *   T014  endConversionCall: hook non-blocking, job INTERACTION en BD
 */
require('dotenv').config({ quiet: true });
const prisma = require('../../../src/config/database');
const { enqueueSync } = require('../../../src/services/twenty/twentySyncService');
const { enqueueInteractionSync } = require('../../../src/services/twenty/twentyActivityService');
const {
  endDiscoveryCall,
  endQualificationCall,
  endActivationCall,
  endConversionCall,
} = require('../../../src/services/funnelWebhookService');

let passed = 0;
let failed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    const msg = `${label}${detail ? ' -> ' + detail : ''}`;
    console.log(`  FAIL  ${msg}`);
    failures.push(msg);
  }
}

async function neutralizePipeline(establishmentId) {
  await prisma.twentySyncJob.updateMany({
    where: { establishmentId, type: 'PIPELINE', status: { in: ['PENDING', 'PROCESSING'] } },
    data: { status: 'DONE' },
  });
}

// Polling robusto: reintenta cada 100ms hasta encontrar el job o agotar maxMs
async function waitForJob(where, maxMs = 2000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const job = await prisma.twentySyncJob.findFirst({ where });
    if (job) return job;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

// Replica local de enqueueCampaignSync para T010 (la funcion no esta exportada)
async function enqueueCampaignSyncTest(stage, { establishmentId, conversationId, outcome, callSummary, callDuration, campaignId, campaignName }) {
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

// ================================================================
// T010 — enqueueCampaignSync helper
// ================================================================
async function runT010(ESTAB) {
  const TS = Date.now();
  const createdJobIds = [];

  await neutralizePipeline(ESTAB);

  // C1 + C2 + C3: Una llamada -> PIPELINE + INTERACTION correctos
  console.log('\nT010/C1/C2/C3: enqueueCampaignSync crea PIPELINE + INTERACTION');
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

  // C4: Las 4 etapas generan el reason correcto en PIPELINE
  console.log('\nT010/C4: formato CALL_{STAGE} para las 4 etapas');
  for (const stage of ['qualification', 'activation', 'conversion']) {
    await neutralizePipeline(ESTAB);
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
    check(`${stage}: PIPELINE.reason === CALL_${stage.toUpperCase()}`, pJob?.reason === `CALL_${stage.toUpperCase()}`, pJob?.reason);
    check(`${stage}: INTERACTION creado`, !!iid);
  }

  // Cleanup T010
  const deleted = await prisma.twentySyncJob.deleteMany({ where: { id: { in: createdJobIds } } });
  console.log(`  T010 cleanup: ${deleted.count} jobs eliminados.`);
}

// ================================================================
// T011 — endDiscoveryCall hook
// ================================================================
async function runT011(ESTAB) {
  const TS = Date.now();
  const createdDedupeKeys = [];

  await neutralizePipeline(ESTAB);

  // C1 + C2 + C3: Outcome conversacional
  console.log('\nT011/C1/C2/C3: endDiscoveryCall con outcome conversacional');
  const CONV_A = `t011-conv-a-${TS}`;
  createdDedupeKeys.push(`interaction:${CONV_A}:discovery`);

  let resultA;
  try {
    resultA = await endDiscoveryCall({
      conversationId: CONV_A,
      establishmentId: ESTAB,
      outcome: 'ADVANCE_TO_ACTIVATION',
      originalOutcome: 'INTERESTED',
      contactName: 'Test T011',
      contactEmail: null,
      businessType: 'restaurante',
      painPoint: 'pedidos manuales',
      interestLevel: 'HIGH',
      callSummary: 'Resumen de prueba T011 conversacional',
      callDuration: 120,
    });
  } catch (err) {
    check('C5: endDiscoveryCall no lanza error', false, err.message);
  }

  check('C5: retorna { success: true }', resultA?.success === true, JSON.stringify(resultA));
  check('C5: retorna outcome', !!resultA?.outcome, resultA?.outcome);

  const pipelineJobA = await waitForJob({
    establishmentId: ESTAB, type: 'PIPELINE', reason: 'CALL_DISCOVERY', status: 'PENDING',
  });
  const interactionJobA = await waitForJob({ dedupeKey: `interaction:${CONV_A}:discovery` });

  check('C1: job PIPELINE creado con reason=CALL_DISCOVERY', !!pipelineJobA, 'no encontrado');
  check('C2: job INTERACTION creado', !!interactionJobA, 'no encontrado');
  check('C2: dedupeKey correcto', interactionJobA?.dedupeKey === `interaction:${CONV_A}:discovery`, interactionJobA?.dedupeKey);
  check('C3: outcome conversacional -> maxAttempts=null', interactionJobA?.maxAttempts === null, String(interactionJobA?.maxAttempts));
  check('C3: payload.stage === discovery', interactionJobA?.payload?.stage === 'discovery', interactionJobA?.payload?.stage);

  // C4: Outcome no-conversacional -> maxAttempts=5
  console.log('\nT011/C4: endDiscoveryCall con outcome no-conversacional (NO_ANSWER)');
  await neutralizePipeline(ESTAB);

  const CONV_B = `t011-conv-b-${TS}`;
  createdDedupeKeys.push(`interaction:${CONV_B}:discovery`);

  await endDiscoveryCall({
    conversationId: CONV_B,
    establishmentId: ESTAB,
    outcome: 'NO_ANSWER',
    originalOutcome: null,
    contactName: null,
    contactEmail: null,
    businessType: null,
    painPoint: null,
    interestLevel: null,
    callSummary: null,
    callDuration: 0,
  });

  const interactionJobB = await waitForJob({ dedupeKey: `interaction:${CONV_B}:discovery` });

  check('C4: job INTERACTION creado para NO_ANSWER', !!interactionJobB, 'no encontrado');
  check('C4: outcome no-conversacional -> maxAttempts=5', interactionJobB?.maxAttempts === 5, String(interactionJobB?.maxAttempts));
  check('C4: payload.outcome === NO_ANSWER', interactionJobB?.payload?.outcome === 'NO_ANSWER', interactionJobB?.payload?.outcome);

  // C6: Si el hook falla, endDiscoveryCall igual retorna success
  console.log('\nT011/C6: endDiscoveryCall retorna success aunque enqueueInteractionSync falle');
  const activityServicePath = require.resolve('../../../src/services/twenty/twentyActivityService');
  const funnelServicePath = require.resolve('../../../src/services/funnelWebhookService');
  const originalActivityExports = require.cache[activityServicePath].exports;

  require.cache[activityServicePath].exports = {
    ...originalActivityExports,
    enqueueInteractionSync: () => Promise.reject(new Error('simulated hook error')),
  };
  delete require.cache[funnelServicePath];
  const { endDiscoveryCall: endDiscoveryCallWithFailingHook } = require('../../../src/services/funnelWebhookService');

  await neutralizePipeline(ESTAB);
  const CONV_C = `t011-conv-c-${TS}`;
  let resultC;
  try {
    resultC = await endDiscoveryCallWithFailingHook({
      conversationId: CONV_C,
      establishmentId: ESTAB,
      outcome: 'ADVANCE_TO_ACTIVATION',
      originalOutcome: 'INTERESTED',
      contactName: 'Test T011 C6',
      contactEmail: null,
      businessType: null,
      painPoint: null,
      interestLevel: null,
      callSummary: null,
      callDuration: 0,
    });
  } catch (err) {
    check('C6: endDiscoveryCall no lanza aunque hook falle', false, err.message);
  }

  check('C6: retorna { success: true } aunque hook falle', resultC?.success === true, JSON.stringify(resultC));
  check('C6: retorna outcome aunque hook falle', !!resultC?.outcome, resultC?.outcome);

  // Restaurar modulos originales
  require.cache[activityServicePath].exports = originalActivityExports;
  delete require.cache[funnelServicePath];

  // Cleanup T011
  await prisma.twentySyncJob.deleteMany({ where: { dedupeKey: { in: createdDedupeKeys } } });
  await prisma.twentySyncJob.deleteMany({
    where: { establishmentId: ESTAB, type: 'PIPELINE', reason: 'CALL_DISCOVERY' },
  });
  console.log('  T011 cleanup: jobs eliminados.');
}

// ================================================================
// T012 — endQualificationCall hook
// ================================================================
async function runT012(ESTAB) {
  const TS = Date.now();
  const createdDedupeKeys = [];

  await neutralizePipeline(ESTAB);

  console.log('\nT012/C1/C2/C3: endQualificationCall con outcome conversacional (QUALIFIED)');
  const CONV_A = `t012-conv-a-${TS}`;
  createdDedupeKeys.push(`interaction:${CONV_A}:qualification`);

  let resultA;
  try {
    resultA = await endQualificationCall({
      conversationId: CONV_A,
      establishmentId: ESTAB,
      outcome: 'QUALIFIED',
      callSummary: 'Resumen de prueba T012 conversacional',
    });
  } catch (err) {
    check('C5: endQualificationCall no lanza error', false, err.message);
  }

  check('C5: retorna { success: true }', resultA?.success === true, JSON.stringify(resultA));
  check('C5: retorna outcome', !!resultA?.outcome, resultA?.outcome);

  const pipelineJobA = await waitForJob({
    establishmentId: ESTAB, type: 'PIPELINE', reason: 'CALL_QUALIFICATION', status: 'PENDING',
  });
  const interactionJobA = await waitForJob({ dedupeKey: `interaction:${CONV_A}:qualification` });

  check('C1: job PIPELINE creado con reason=CALL_QUALIFICATION', !!pipelineJobA, 'no encontrado');
  check('C2: job INTERACTION creado', !!interactionJobA, 'no encontrado');
  check('C2: dedupeKey correcto', interactionJobA?.dedupeKey === `interaction:${CONV_A}:qualification`, interactionJobA?.dedupeKey);
  check('C3: outcome conversacional -> maxAttempts=null', interactionJobA?.maxAttempts === null, String(interactionJobA?.maxAttempts));
  check('C3: payload.stage === qualification', interactionJobA?.payload?.stage === 'qualification', interactionJobA?.payload?.stage);

  console.log('\nT012/C4: endQualificationCall con outcome no-conversacional (NO_ANSWER)');
  await neutralizePipeline(ESTAB);

  const CONV_B = `t012-conv-b-${TS}`;
  createdDedupeKeys.push(`interaction:${CONV_B}:qualification`);

  await endQualificationCall({ conversationId: CONV_B, establishmentId: ESTAB, outcome: 'NO_ANSWER', callSummary: null });

  const interactionJobB = await waitForJob({ dedupeKey: `interaction:${CONV_B}:qualification` });

  check('C4: job INTERACTION creado para NO_ANSWER', !!interactionJobB, 'no encontrado');
  check('C4: outcome no-conversacional -> maxAttempts=5', interactionJobB?.maxAttempts === 5, String(interactionJobB?.maxAttempts));
  check('C4: payload.outcome === NO_ANSWER', interactionJobB?.payload?.outcome === 'NO_ANSWER', interactionJobB?.payload?.outcome);

  // Cleanup T012
  await prisma.twentySyncJob.deleteMany({ where: { dedupeKey: { in: createdDedupeKeys } } });
  await prisma.twentySyncJob.deleteMany({
    where: { establishmentId: ESTAB, type: 'PIPELINE', reason: 'CALL_QUALIFICATION' },
  });
  console.log('  T012 cleanup: jobs eliminados.');
}

// ================================================================
// T013 — endActivationCall hook
// ================================================================
async function runT013(ESTAB) {
  const TS = Date.now();
  const createdDedupeKeys = [];

  await neutralizePipeline(ESTAB);

  console.log('\nT013/C1/C2/C3: endActivationCall con outcome conversacional (DEMO_SCHEDULED)');
  const CONV_A = `t013-conv-a-${TS}`;
  createdDedupeKeys.push(`interaction:${CONV_A}:activation`);

  let resultA;
  try {
    resultA = await endActivationCall({
      conversationId: CONV_A,
      establishmentId: ESTAB,
      outcome: 'DEMO_SCHEDULED',
      demoDate: null,
      callSummary: 'Resumen de prueba T013 conversacional',
    });
  } catch (err) {
    check('C5: endActivationCall no lanza error', false, err.message);
  }

  check('C5: retorna { success: true }', resultA?.success === true, JSON.stringify(resultA));
  check('C5: retorna outcome', !!resultA?.outcome, resultA?.outcome);

  const pipelineJobA = await waitForJob({
    establishmentId: ESTAB, type: 'PIPELINE', reason: 'CALL_ACTIVATION', status: 'PENDING',
  });
  const interactionJobA = await waitForJob({ dedupeKey: `interaction:${CONV_A}:activation` });

  check('C1: job PIPELINE creado con reason=CALL_ACTIVATION', !!pipelineJobA, 'no encontrado');
  check('C2: job INTERACTION creado', !!interactionJobA, 'no encontrado');
  check('C2: dedupeKey correcto', interactionJobA?.dedupeKey === `interaction:${CONV_A}:activation`, interactionJobA?.dedupeKey);
  check('C3: outcome conversacional -> maxAttempts=null', interactionJobA?.maxAttempts === null, String(interactionJobA?.maxAttempts));
  check('C3: payload.stage === activation', interactionJobA?.payload?.stage === 'activation', interactionJobA?.payload?.stage);

  console.log('\nT013/C4: endActivationCall con outcome no-conversacional (VOICEMAIL)');
  await neutralizePipeline(ESTAB);

  const CONV_B = `t013-conv-b-${TS}`;
  createdDedupeKeys.push(`interaction:${CONV_B}:activation`);

  await endActivationCall({ conversationId: CONV_B, establishmentId: ESTAB, outcome: 'VOICEMAIL', demoDate: null, callSummary: null });

  const interactionJobB = await waitForJob({ dedupeKey: `interaction:${CONV_B}:activation` });

  check('C4: job INTERACTION creado para VOICEMAIL', !!interactionJobB, 'no encontrado');
  check('C4: outcome no-conversacional -> maxAttempts=5', interactionJobB?.maxAttempts === 5, String(interactionJobB?.maxAttempts));
  check('C4: payload.outcome === VOICEMAIL', interactionJobB?.payload?.outcome === 'VOICEMAIL', interactionJobB?.payload?.outcome);

  // Cleanup T013
  await prisma.twentySyncJob.deleteMany({ where: { dedupeKey: { in: createdDedupeKeys } } });
  await prisma.twentySyncJob.deleteMany({
    where: { establishmentId: ESTAB, type: 'PIPELINE', reason: 'CALL_ACTIVATION' },
  });
  console.log('  T013 cleanup: jobs eliminados.');
}

// ================================================================
// T014 — endConversionCall hook
// ================================================================
async function runT014(ESTAB) {
  const TS = Date.now();
  const createdDedupeKeys = [];

  await neutralizePipeline(ESTAB);

  console.log('\nT014/C1/C2/C3: endConversionCall con outcome conversacional (CLOSED_WON)');
  const CONV_A = `t014-conv-a-${TS}`;
  createdDedupeKeys.push(`interaction:${CONV_A}:conversion`);

  let resultA;
  try {
    resultA = await endConversionCall({
      conversationId: CONV_A,
      establishmentId: ESTAB,
      outcome: 'CLOSED_WON',
      planClosed: null,
      monthlyRevenue: null,
      callSummary: 'Resumen de prueba T014 conversacional',
    });
  } catch (err) {
    check('C5: endConversionCall no lanza error', false, err.message);
  }

  check('C5: retorna { success: true }', resultA?.success === true, JSON.stringify(resultA));
  check('C5: retorna outcome', !!resultA?.outcome, resultA?.outcome);

  const pipelineJobA = await waitForJob({
    establishmentId: ESTAB, type: 'PIPELINE', reason: 'CALL_CONVERSION', status: 'PENDING',
  });
  const interactionJobA = await waitForJob({ dedupeKey: `interaction:${CONV_A}:conversion` });

  check('C1: job PIPELINE creado con reason=CALL_CONVERSION', !!pipelineJobA, 'no encontrado');
  check('C2: job INTERACTION creado', !!interactionJobA, 'no encontrado');
  check('C2: dedupeKey correcto', interactionJobA?.dedupeKey === `interaction:${CONV_A}:conversion`, interactionJobA?.dedupeKey);
  check('C3: outcome conversacional -> maxAttempts=null', interactionJobA?.maxAttempts === null, String(interactionJobA?.maxAttempts));
  check('C3: payload.stage === conversion', interactionJobA?.payload?.stage === 'conversion', interactionJobA?.payload?.stage);

  console.log('\nT014/C4: endConversionCall con outcome no-conversacional (NO_ANSWER)');
  await neutralizePipeline(ESTAB);

  const CONV_B = `t014-conv-b-${TS}`;
  createdDedupeKeys.push(`interaction:${CONV_B}:conversion`);

  await endConversionCall({ conversationId: CONV_B, establishmentId: ESTAB, outcome: 'NO_ANSWER', planClosed: null, monthlyRevenue: null, callSummary: null });

  const interactionJobB = await waitForJob({ dedupeKey: `interaction:${CONV_B}:conversion` });

  check('C4: job INTERACTION creado para NO_ANSWER', !!interactionJobB, 'no encontrado');
  check('C4: outcome no-conversacional -> maxAttempts=5', interactionJobB?.maxAttempts === 5, String(interactionJobB?.maxAttempts));
  check('C4: payload.outcome === NO_ANSWER', interactionJobB?.payload?.outcome === 'NO_ANSWER', interactionJobB?.payload?.outcome);

  // Cleanup T014
  await prisma.twentySyncJob.deleteMany({ where: { dedupeKey: { in: createdDedupeKeys } } });
  await prisma.twentySyncJob.deleteMany({
    where: { establishmentId: ESTAB, type: 'PIPELINE', reason: 'CALL_CONVERSION' },
  });
  console.log('  T014 cleanup: jobs eliminados.');
}

// ================================================================
// Main
// ================================================================
async function run() {
  const enrichment = await prisma.establishmentEnrichment.findFirst({ select: { establishmentId: true } });
  if (!enrichment) {
    console.error('No hay EstablishmentEnrichment en la BD. Aborto.');
    process.exit(1);
  }
  const ESTAB = enrichment.establishmentId;

  console.log('=== T010: enqueueCampaignSync helper ===');
  await runT010(ESTAB);

  console.log('\n=== T011: endDiscoveryCall hook ===');
  await runT011(ESTAB);

  console.log('\n=== T012: endQualificationCall hook ===');
  await runT012(ESTAB);

  console.log('\n=== T013: endActivationCall hook ===');
  await runT013(ESTAB);

  console.log('\n=== T014: endConversionCall hook ===');
  await runT014(ESTAB);

  console.log(`\n========================================`);
  console.log(`RESULTADO TOTAL: ${passed} PASS, ${failed} FAIL`);
  if (failures.length > 0) {
    console.log('\nFALLOS:');
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  }
  console.log(`========================================`);

  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(async (err) => {
  console.error('\nError fatal:', err.message);
  await prisma.$disconnect();
  process.exit(1);
});
