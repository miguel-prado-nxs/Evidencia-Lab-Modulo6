/**
 * Test Phase 3 — US1: Historial de interacciones en Twenty CRM
 * Uso: node prisma/scripts/testconciliaciondatos/test-phase3-criterios.js
 *
 * Cubre T010–T016:
 *   T010  enqueueCampaignSync: crea PIPELINE + INTERACTION por llamada
 *   T011  endDiscoveryCall: hook non-blocking, job INTERACTION en BD, no interrumpe si falla
 *   T012  endQualificationCall: hook non-blocking, job INTERACTION en BD
 *   T013  endActivationCall: hook non-blocking, job INTERACTION en BD
 *   T014  endConversionCall: hook non-blocking, job INTERACTION en BD
 *   T015  Fallback webhook: campaignWebhookController encola INTERACTION en outcomes FAILED/NO_ANSWER/VOICEMAIL
 *   T016  GAP-1: processInteractionJob maneja Company inexistente en Twenty (skip silencioso)
 */
require('dotenv').config({ quiet: true });
// Debe estar antes del require del controller para que el middleware lo lea al cargar
process.env.ALLOW_UNVERIFIED_ELEVENLABS_WEBHOOKS = 'true';

const prisma = require('../../../src/config/database');
const logger = require('../../../src/config/logger');
const { enqueueSync } = require('../../../src/services/twenty/twentySyncService');
const { enqueueInteractionSync, processInteractionJob } = require('../../../src/services/twenty/twentyActivityService');
const {
  endDiscoveryCall,
  endQualificationCall,
  endActivationCall,
  endConversionCall,
} = require('../../../src/services/funnelWebhookService');
const { handleElevenLabsWebhook } = require('../../../src/controllers/campaignWebhookController');

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

// Mock de req/res Express minimo para llamar el controller directamente
function makeReqRes(body) {
  let responseStatus = null;
  let responseBody = null;
  const req = {
    originalUrl: '/api/v1/campaigns/elevenlabs-webhook',
    method: 'POST',
    body,
    rawBody: Buffer.from(JSON.stringify(body)),
    get: () => null,
  };
  const res = {
    status(code) { responseStatus = code; return this; },
    json(b) { responseBody = b; return this; },
    getResponse: () => ({ status: responseStatus, body: responseBody }),
  };
  const next = (err) => { throw err; };
  return { req, res, next };
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

  const pipelineJobA = await waitForJob({ establishmentId: ESTAB, type: 'PIPELINE', reason: 'CALL_DISCOVERY', status: 'PENDING' });
  const interactionJobA = await waitForJob({ dedupeKey: `interaction:${CONV_A}:discovery` });

  check('C1: job PIPELINE creado con reason=CALL_DISCOVERY', !!pipelineJobA, 'no encontrado');
  check('C2: job INTERACTION creado', !!interactionJobA, 'no encontrado');
  check('C2: dedupeKey correcto', interactionJobA?.dedupeKey === `interaction:${CONV_A}:discovery`, interactionJobA?.dedupeKey);
  check('C3: outcome conversacional -> maxAttempts=null', interactionJobA?.maxAttempts === null, String(interactionJobA?.maxAttempts));
  check('C3: payload.stage === discovery', interactionJobA?.payload?.stage === 'discovery', interactionJobA?.payload?.stage);

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

  await prisma.twentySyncJob.deleteMany({ where: { dedupeKey: { in: createdDedupeKeys } } });
  await prisma.twentySyncJob.deleteMany({ where: { establishmentId: ESTAB, type: 'PIPELINE', reason: 'CALL_DISCOVERY' } });
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

  const pipelineJobA = await waitForJob({ establishmentId: ESTAB, type: 'PIPELINE', reason: 'CALL_QUALIFICATION', status: 'PENDING' });
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

  await prisma.twentySyncJob.deleteMany({ where: { dedupeKey: { in: createdDedupeKeys } } });
  await prisma.twentySyncJob.deleteMany({ where: { establishmentId: ESTAB, type: 'PIPELINE', reason: 'CALL_QUALIFICATION' } });
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

  const pipelineJobA = await waitForJob({ establishmentId: ESTAB, type: 'PIPELINE', reason: 'CALL_ACTIVATION', status: 'PENDING' });
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

  await prisma.twentySyncJob.deleteMany({ where: { dedupeKey: { in: createdDedupeKeys } } });
  await prisma.twentySyncJob.deleteMany({ where: { establishmentId: ESTAB, type: 'PIPELINE', reason: 'CALL_ACTIVATION' } });
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

  const pipelineJobA = await waitForJob({ establishmentId: ESTAB, type: 'PIPELINE', reason: 'CALL_CONVERSION', status: 'PENDING' });
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

  await prisma.twentySyncJob.deleteMany({ where: { dedupeKey: { in: createdDedupeKeys } } });
  await prisma.twentySyncJob.deleteMany({ where: { establishmentId: ESTAB, type: 'PIPELINE', reason: 'CALL_CONVERSION' } });
  console.log('  T014 cleanup: jobs eliminados.');
}

// ================================================================
// T015 — Fallback webhook INTERACTION en campaignWebhookController
// ================================================================
async function runT015() {
  const TS = Date.now();
  const CONV_A = `t015-conv-a-${TS}`; // fallback crea INTERACTION
  const CONV_B = `t015-conv-b-${TS}`; // MCP ya creo INTERACTION -> deduplicacion

  const enrichment = await prisma.establishmentEnrichment.findFirst({ select: { establishmentId: true } });
  if (!enrichment) throw new Error('No hay EstablishmentEnrichment en la BD.');
  const ESTAB_A = enrichment.establishmentId;
  const ESTAB_B = `${enrichment.establishmentId}-t015b`;

  const campaign = await prisma.campaign.create({
    data: { name: '[TEST] T015 Webhook Fallback', type: 'DISCOVERY', status: 'ACTIVE' },
  });

  await prisma.campaignContact.create({
    data: { campaignId: campaign.id, establishmentId: ESTAB_A, establishmentPhone: '+5210000015001', conversationId: CONV_A, status: 'CALLING' },
  });

  await prisma.campaignContact.create({
    data: { campaignId: campaign.id, establishmentId: ESTAB_B, establishmentPhone: '+5210000015002', conversationId: CONV_B, status: 'CALLING' },
  });

  // Pre-crear job INTERACTION para CONV_B (simula que el agente MCP ya disparo el hook)
  await prisma.twentySyncJob.create({
    data: {
      establishmentId: ESTAB_B,
      type: 'INTERACTION',
      status: 'PENDING',
      reason: 'discovery:NO_ANSWER',
      dedupeKey: `interaction:${CONV_B}:discovery`,
      maxAttempts: 5,
      payload: { conversationId: CONV_B, stage: 'discovery', outcome: 'NO_ANSWER' },
      nextRunAt: new Date(),
    },
  });

  // C1 + C3 + C4: Webhook FAILED sin INTERACTION previo
  console.log('\nT015/C1/C3/C4: Webhook FAILED sin INTERACTION previo -> fallback crea job');
  const body1 = { type: 'post_call_transcription', data: { conversation_id: CONV_A, call_successful: false } };
  const { req: req1, res: res1, next: next1 } = makeReqRes(body1);
  await handleElevenLabsWebhook(req1, res1, next1);

  check('C3: webhook retorna 200', res1.getResponse().status === 200, String(res1.getResponse().status));

  const interactionA = await waitForJob({ dedupeKey: `interaction:${CONV_A}:discovery` });
  check('C1: job INTERACTION creado por fallback', !!interactionA, 'no encontrado');
  check('C1: type === INTERACTION', interactionA?.type === 'INTERACTION', interactionA?.type);
  check('C1: dedupeKey correcto', interactionA?.dedupeKey === `interaction:${CONV_A}:discovery`, interactionA?.dedupeKey);
  check('C4: maxAttempts=5 (FAILED es no-conversacional)', interactionA?.maxAttempts === 5, String(interactionA?.maxAttempts));

  // C2 + C3: Si MCP ya creo el INTERACTION, fallback no duplica
  console.log('\nT015/C2/C3: Webhook FAILED con INTERACTION ya existente -> no duplica');
  const body2 = { type: 'post_call_transcription', data: { conversation_id: CONV_B, call_successful: false } };
  const { req: req2, res: res2, next: next2 } = makeReqRes(body2);
  await handleElevenLabsWebhook(req2, res2, next2);

  await new Promise((r) => setTimeout(r, 500));

  const countB = await prisma.twentySyncJob.count({ where: { dedupeKey: `interaction:${CONV_B}:discovery` } });
  check('C2: solo 1 job INTERACTION (no duplicado)', countB === 1, String(countB));
  check('C3: webhook retorna 200 aunque fallback sea ignorado', res2.getResponse().status === 200, String(res2.getResponse().status));

  // Cleanup
  await prisma.twentySyncJob.deleteMany({
    where: { dedupeKey: { in: [`interaction:${CONV_A}:discovery`, `interaction:${CONV_B}:discovery`] } },
  });
  await prisma.twentySyncJob.deleteMany({ where: { establishmentId: { in: [ESTAB_A, ESTAB_B] }, type: 'PIPELINE' } });
  await prisma.campaignContact.deleteMany({ where: { campaignId: campaign.id } });
  await prisma.campaign.delete({ where: { id: campaign.id } });
  console.log('  T015 cleanup: done.');
}

// ================================================================
// T016 — GAP-1: processInteractionJob maneja Company inexistente
// ================================================================
async function runT016() {
  const TS = Date.now();
  const ESTAB_NO_STATE = `t016-nostate-${TS}`;
  const ESTAB_NULL_ID  = `t016-nullid-${TS}`;

  await prisma.twentySyncState.deleteMany({
    where: { establishmentId: { in: [ESTAB_NO_STATE, ESTAB_NULL_ID] } },
  });

  await prisma.twentySyncState.create({
    data: { establishmentId: ESTAB_NULL_ID, twentyEstablecimientoId: null },
  });

  const makeJob = (establishmentId) => ({
    id: `fake-job-${TS}`,
    establishmentId,
    payload: { conversationId: `conv-${TS}`, stage: 'discovery', outcome: 'NO_ANSWER', callSummary: null, callDuration: null, campaignName: null },
  });

  // C1: Sin TwentySyncState -> debe lanzar Error
  console.log('\nT016/C1: Sin TwentySyncState -> throw');
  let threwC1 = false;
  let errorMsgC1 = '';
  try {
    await processInteractionJob(makeJob(ESTAB_NO_STATE));
  } catch (err) {
    threwC1 = true;
    errorMsgC1 = err.message;
  }

  check('C1: lanza Error cuando no hay TwentySyncState', threwC1, 'no lanzo error');
  check('C1: mensaje menciona TwentySyncState o establishmentId', errorMsgC1.includes('TwentySyncState') || errorMsgC1.includes(ESTAB_NO_STATE), errorMsgC1);

  // C2 + C3: TwentySyncState con twentyEstablecimientoId=null -> skip silencioso + logger.error
  console.log('\nT016/C2/C3: TwentySyncState con companyId=null -> no throw, logger.error llamado');

  const loggerErrorCalls = [];
  const originalLoggerError = logger.error.bind(logger);
  logger.error = (...args) => { loggerErrorCalls.push(args); originalLoggerError(...args); };

  let threwC2 = false;
  let returnValueC2;
  try {
    returnValueC2 = await processInteractionJob(makeJob(ESTAB_NULL_ID));
  } catch (err) {
    threwC2 = true;
  } finally {
    logger.error = originalLoggerError;
  }

  check('C2: no lanza Error (retorna sin throw)', !threwC2, 'lanzo un error');
  check('C2: retorna undefined (skip limpio)', returnValueC2 === undefined, String(returnValueC2));

  const relevantLog = loggerErrorCalls.find((args) => typeof args[0] === 'string' && args[0].includes('processInteractionJob'));
  check('C3: logger.error fue llamado', !!relevantLog, 'no se encontro llamada a logger.error');

  if (relevantLog) {
    const meta = relevantLog[1] || {};
    check('C3: log incluye jobId', 'jobId' in meta, JSON.stringify(meta));
    check('C3: log incluye establishmentId correcto', meta.establishmentId === ESTAB_NULL_ID, meta.establishmentId);
    check('C3: log incluye stage', 'stage' in meta, JSON.stringify(meta));
    check('C3: log incluye outcome', 'outcome' in meta, JSON.stringify(meta));
  }

  await prisma.twentySyncState.deleteMany({ where: { establishmentId: { in: [ESTAB_NO_STATE, ESTAB_NULL_ID] } } });
  console.log('  T016 cleanup: done.');
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

  console.log('\n=== T015: Fallback webhook INTERACTION ===');
  await runT015();

  console.log('\n=== T016: GAP-1 Company inexistente en Twenty ===');
  await runT016();

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
