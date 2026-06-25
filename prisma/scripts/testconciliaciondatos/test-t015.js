/**
 * Test T015 — Fallback webhook INTERACTION en campaignWebhookController
 * Uso: node prisma/scripts/testconciliaciondatos/test-t015.js
 *
 * Criterios:
 *   C1: Webhook con outcome FAILED crea job INTERACTION (fallback)
 *   C2: Si MCP ya creo el INTERACTION, el fallback no duplica (dedupeKey collision)
 *   C3: El webhook retorna 200 en ambos casos (fallback no interrumpe flujo)
 *   C4: Job creado tiene maxAttempts=5 (FAILED es no-conversacional)
 */
require('dotenv').config({ quiet: true });
// Bypassar verificacion de firma para tests
process.env.ALLOW_UNVERIFIED_ELEVENLABS_WEBHOOKS = 'true';

const prisma = require('../../../src/config/database');
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
    status(code) {
      responseStatus = code;
      return this;
    },
    json(b) {
      responseBody = b;
      return this;
    },
    getResponse: () => ({ status: responseStatus, body: responseBody }),
  };

  const next = (err) => { throw err; };

  return { req, res, next };
}

async function run() {
  const TS = Date.now();
  const CONV_A = `t015-conv-a-${TS}`; // fallback crea INTERACTION
  const CONV_B = `t015-conv-b-${TS}`; // MCP ya creo INTERACTION -> deduplicacion

  // Obtener un establishmentId real
  const enrichment = await prisma.establishmentEnrichment.findFirst({
    select: { establishmentId: true },
  });
  if (!enrichment) {
    console.error('No hay EstablishmentEnrichment en la BD. Aborto.');
    process.exit(1);
  }
  const ESTAB_A = enrichment.establishmentId;
  const ESTAB_B = `${enrichment.establishmentId}-t015b`; // fake para evitar unique constraint

  // Setup: campana + contactos de prueba
  const campaign = await prisma.campaign.create({
    data: { name: '[TEST] T015 Webhook Fallback', type: 'DISCOVERY', status: 'ACTIVE' },
  });

  const contactA = await prisma.campaignContact.create({
    data: {
      campaignId: campaign.id,
      establishmentId: ESTAB_A,
      establishmentPhone: '+5210000015001',
      conversationId: CONV_A,
      status: 'CALLING',
    },
  });

  const contactB = await prisma.campaignContact.create({
    data: {
      campaignId: campaign.id,
      establishmentId: ESTAB_B,
      establishmentPhone: '+5210000015002',
      conversationId: CONV_B,
      status: 'CALLING',
    },
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

  // ================================================================
  // C1 + C3 + C4: Fallback crea INTERACTION cuando no existe previo
  // ================================================================
  console.log('\nT015/C1/C3/C4: Webhook FAILED sin INTERACTION previo -> fallback crea job');

  // callSuccessful=false sin failureReason -> resolveFinalContactStatus retorna FAILED
  const body1 = {
    type: 'post_call_transcription',
    data: { conversation_id: CONV_A, call_successful: false },
  };

  const { req: req1, res: res1, next: next1 } = makeReqRes(body1);
  await handleElevenLabsWebhook(req1, res1, next1);

  check('C3: webhook retorna 200', res1.getResponse().status === 200, String(res1.getResponse().status));

  const interactionA = await waitForJob({ dedupeKey: `interaction:${CONV_A}:discovery` });

  check('C1: job INTERACTION creado por fallback', !!interactionA, 'no encontrado');
  check('C1: type === INTERACTION', interactionA?.type === 'INTERACTION', interactionA?.type);
  check('C1: stage=discovery en dedupeKey', interactionA?.dedupeKey === `interaction:${CONV_A}:discovery`, interactionA?.dedupeKey);
  check('C4: maxAttempts=5 (FAILED es no-conversacional)', interactionA?.maxAttempts === 5, String(interactionA?.maxAttempts));

  // ================================================================
  // C2 + C3: Si MCP ya creo el INTERACTION, fallback no duplica
  // ================================================================
  console.log('\nT015/C2/C3: Webhook FAILED con INTERACTION ya existente -> no duplica');

  const body2 = {
    type: 'post_call_transcription',
    data: { conversation_id: CONV_B, call_successful: false },
  };

  const { req: req2, res: res2, next: next2 } = makeReqRes(body2);
  await handleElevenLabsWebhook(req2, res2, next2);

  // Dar tiempo al fallback para intentar (y fallar silenciosamente con P2002)
  await new Promise((r) => setTimeout(r, 500));

  const countB = await prisma.twentySyncJob.count({
    where: { dedupeKey: `interaction:${CONV_B}:discovery` },
  });

  check('C2: solo 1 job INTERACTION (no duplicado)', countB === 1, String(countB));
  check('C3: webhook retorna 200 aunque fallback sea ignorado', res2.getResponse().status === 200, String(res2.getResponse().status));

  // Cleanup
  await prisma.twentySyncJob.deleteMany({
    where: {
      dedupeKey: { in: [`interaction:${CONV_A}:discovery`, `interaction:${CONV_B}:discovery`] },
    },
  });
  await prisma.twentySyncJob.deleteMany({
    where: { establishmentId: { in: [ESTAB_A, ESTAB_B] }, type: 'PIPELINE' },
  });
  await prisma.campaignContact.deleteMany({ where: { campaignId: campaign.id } });
  await prisma.campaign.delete({ where: { id: campaign.id } });
  console.log('  T015 cleanup: done.');

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
