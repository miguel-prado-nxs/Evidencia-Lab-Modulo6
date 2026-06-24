/**
 * Test de criterios T008 — enqueueSync solo colapsa PIPELINE
 * Uso: node prisma/scripts/test-t008-criterios.js
 *
 * Criterios cubiertos:
 *   C1  enqueueSync crea job type=PIPELINE con reason correcto
 *   C2  Segundo enqueueSync PIPELINE (mismo establishment, PENDING) colapsa -> mismo jobId
 *   C3  Job INTERACTION PENDING existente NO interfiere con colapso de nuevo PIPELINE
 *   C4  Dos jobs INTERACTION para mismo establishment coexisten sin colision (no se colapsan entre si)
 */
require('dotenv').config({ quiet: true });
const prisma = require('../../src/config/database');
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

async function run() {
  const CONV_A = `t008-conv-a-${Date.now()}`;
  const CONV_B = `t008-conv-b-${Date.now()}`;

  // Necesitamos un establishmentId real (FK). Tomamos el primero de enrichment.
  const enrichment = await prisma.establishmentEnrichment.findFirst({
    select: { establishmentId: true },
  });
  if (!enrichment) {
    console.error('No hay EstablishmentEnrichment en la BD. Aborto.');
    process.exit(1);
  }
  const ESTAB = enrichment.establishmentId;

  // Asegurarse de que no haya jobs PIPELINE pendientes para el establishment antes de empezar
  await prisma.twentySyncJob.updateMany({
    where: {
      establishmentId: ESTAB,
      type: 'PIPELINE',
      status: { in: ['PENDING', 'PROCESSING'] },
    },
    data: { status: 'DONE' },
  });

  // ============================================================
  // C1: enqueueSync crea job type=PIPELINE
  // ============================================================
  console.log('\nC1: enqueueSync crea job PIPELINE');
  const jobId1 = await enqueueSync({
    establishmentId: ESTAB,
    partnerId: 'TEST_PARTNER',
    reason: 'TEST_REASON_C1',
  });
  if (jobId1) createdJobIds.push(jobId1);

  check('retorna jobId', !!jobId1);
  const job1 = jobId1 ? await prisma.twentySyncJob.findUnique({ where: { id: jobId1 } }) : null;
  check('job.type === PIPELINE', job1?.type === 'PIPELINE', job1?.type);
  check('job.status === PENDING', job1?.status === 'PENDING', job1?.status);
  check('job.reason === TEST_REASON_C1', job1?.reason === 'TEST_REASON_C1', job1?.reason);

  // ============================================================
  // C2: Segundo enqueueSync PIPELINE -> colapsa (retorna mismo jobId, actualiza reason)
  // ============================================================
  console.log('\nC2: Colapso de PIPELINE (segundo enqueue mismo establishment)');
  const jobId2 = await enqueueSync({
    establishmentId: ESTAB,
    partnerId: 'TEST_PARTNER',
    reason: 'TEST_REASON_C2',
  });
  if (jobId2 && jobId2 !== jobId1) createdJobIds.push(jobId2);

  check('segundo enqueue retorna mismo jobId', jobId2 === jobId1, `jobId1=${jobId1} jobId2=${jobId2}`);
  const job2updated = jobId1 ? await prisma.twentySyncJob.findUnique({ where: { id: jobId1 } }) : null;
  check('reason actualizado a TEST_REASON_C2', job2updated?.reason === 'TEST_REASON_C2', job2updated?.reason);

  // Contar: solo debe haber 1 job PIPELINE PENDING para este establishment
  const pipelineCount = await prisma.twentySyncJob.count({
    where: {
      establishmentId: ESTAB,
      type: 'PIPELINE',
      status: { in: ['PENDING', 'PROCESSING'] },
    },
  });
  check('solo existe 1 PIPELINE PENDING para el establishment', pipelineCount === 1, `count=${pipelineCount}`);

  // ============================================================
  // C3: Job INTERACTION PENDING no interfiere con colapso de nuevo PIPELINE
  //     El PIPELINE debe seguir colapsando incluso cuando hay un INTERACTION pendiente
  // ============================================================
  console.log('\nC3: INTERACTION PENDING no bloquea colapso de PIPELINE');

  // Crear un INTERACTION pendiente para el mismo establishment
  const interactionId = await enqueueInteractionSync({
    establishmentId: ESTAB,
    conversationId: CONV_A,
    stage: 'discovery',
    outcome: 'COMPLETED',
    callSummary: 'Test C3',
    callDuration: 60,
    campaignId: null,
    campaignName: null,
  });
  if (interactionId) createdJobIds.push(interactionId);

  check('INTERACTION encolado', !!interactionId);

  // Ahora un tercer enqueueSync PIPELINE -> debe seguir colapsando con el mismo job PIPELINE
  const jobId3 = await enqueueSync({
    establishmentId: ESTAB,
    partnerId: 'TEST_PARTNER',
    reason: 'TEST_REASON_C3',
  });
  if (jobId3 && jobId3 !== jobId1) createdJobIds.push(jobId3);

  check('tercer PIPELINE colapsa con el primero (no crea nuevo)', jobId3 === jobId1, `jobId1=${jobId1} jobId3=${jobId3}`);

  // Verificar que el INTERACTION sigue existiendo (no fue absorbido)
  const interactionStillExists = interactionId
    ? await prisma.twentySyncJob.findUnique({ where: { id: interactionId } })
    : null;
  check('INTERACTION PENDING sigue intacto', interactionStillExists?.status === 'PENDING', interactionStillExists?.status);

  // Verificar conteos: 1 PIPELINE y 1 INTERACTION pendientes
  const [pipelineAfter, interactionAfter] = await Promise.all([
    prisma.twentySyncJob.count({
      where: { establishmentId: ESTAB, type: 'PIPELINE', status: { in: ['PENDING', 'PROCESSING'] } },
    }),
    prisma.twentySyncJob.count({
      where: { establishmentId: ESTAB, type: 'INTERACTION', status: 'PENDING', id: interactionId || '' },
    }),
  ]);
  check('exactamente 1 PIPELINE PENDING', pipelineAfter === 1, `count=${pipelineAfter}`);
  check('exactamente 1 INTERACTION PENDING (el nuestro)', interactionAfter === 1, `count=${interactionAfter}`);

  // ============================================================
  // C4: Dos INTERACTION para mismo establishment coexisten (no se colapsan entre si)
  //     La deduplicacion de INTERACTION es por dedupeKey (conv+stage), no por establishment
  // ============================================================
  console.log('\nC4: Dos INTERACTION distintos coexisten sin colision');

  // Segundo INTERACTION para el mismo establishment pero diferente conversacion+etapa
  const interactionId2 = await enqueueInteractionSync({
    establishmentId: ESTAB,
    conversationId: CONV_B,
    stage: 'qualification',
    outcome: 'NO_ANSWER',
    callSummary: null,
    callDuration: null,
    campaignId: null,
    campaignName: null,
  });
  if (interactionId2) createdJobIds.push(interactionId2);

  check('segundo INTERACTION con distinta conv+stage retorna nuevo jobId', !!interactionId2 && interactionId2 !== interactionId, `id1=${interactionId} id2=${interactionId2}`);

  // Verificar que ambos INTERACTION existen y son distintos jobs
  const bothExist =
    interactionId && interactionId2
      ? await prisma.twentySyncJob.count({
          where: {
            id: { in: [interactionId, interactionId2] },
            type: 'INTERACTION',
            status: 'PENDING',
          },
        })
      : 0;
  check('ambos INTERACTION PENDING existen en BD', bothExist === 2, `count=${bothExist}`);

  // ============================================================
  // Cleanup
  // ============================================================
  console.log('\nLimpiando datos de prueba...');
  await prisma.twentySyncJob.deleteMany({
    where: { id: { in: createdJobIds } },
  });
  // Restaurar el job PIPELINE original a DONE si aun existe
  if (jobId1) {
    await prisma.twentySyncJob.deleteMany({ where: { id: jobId1 } }).catch(() => {});
  }
  console.log(`  ${createdJobIds.length} jobs eliminados.`);

  // ============================================================
  // Resumen
  // ============================================================
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
