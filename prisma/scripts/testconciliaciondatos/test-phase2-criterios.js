/**
 * Test Phase 2 — Foundational: infraestructura de jobs INTERACTION
 * Uso: node prisma/scripts/testconciliaciondatos/test-phase2-criterios.js
 *
 * Cubre T007, T008, T009:
 *   T007  twentyActivityService: STAGE_CONFIG, enqueueInteractionSync, processInteractionJob
 *   T008  enqueueSync: colapso solo para PIPELINE, INTERACTION no interfiere
 *   T009  processPendingJobs: bifurcacion por job.type, retry y FAILED logic
 */
require('dotenv').config({ quiet: true });
const prisma = require('../../../src/config/database');
const twentyService = require('../../../src/services/twenty/twentyService');
const { enqueueSync, processPendingJobs } = require('../../../src/services/twenty/twentySyncService');
const {
  STAGE_CONFIG,
  enqueueInteractionSync,
  processInteractionJob,
} = require('../../../src/services/twenty/twentyActivityService');

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ' -> ' + detail : ''}`);
  }
}

// ================================================================
// T007 — twentyActivityService
// ================================================================
async function runT007(ESTAB) {
  const CONV = `t007-${Date.now()}`;
  const createdJobIds = [];
  const createdNoteIds = [];

  // C1: STAGE_CONFIG tiene las 6 etapas
  console.log('\nT007/C1: STAGE_CONFIG');
  const expectedStages = ['discovery', 'qualification', 'activation', 'conversion', 'coupon_sent', 'coupon_redeemed'];
  for (const s of expectedStages) {
    check(`etapa "${s}" existe`, !!STAGE_CONFIG[s], `STAGE_CONFIG[${s}] indefinido`);
  }
  check(
    'discovery tiene stageLabel/isConversational/outcomeLabels',
    STAGE_CONFIG.discovery?.stageLabel &&
      typeof STAGE_CONFIG.discovery?.isConversational === 'function' &&
      STAGE_CONFIG.discovery?.outcomeLabels
  );

  // C2: enqueueInteractionSync crea job con dedupeKey correcto
  console.log('\nT007/C2: enqueueInteractionSync crea job INTERACTION');
  const jobId = await enqueueInteractionSync({
    establishmentId: ESTAB,
    conversationId: CONV,
    stage: 'discovery',
    outcome: 'COMPLETED',
    callSummary: 'Resumen de prueba conversacional.',
    callDuration: 95,
    campaignId: 'camp-t007',
    campaignName: '[TEST] Campana T007',
  });
  if (jobId) createdJobIds.push(jobId);

  check('retorna jobId', !!jobId);
  const job = jobId ? await prisma.twentySyncJob.findUnique({ where: { id: jobId } }) : null;
  check('job.type === INTERACTION', job?.type === 'INTERACTION', job?.type);
  check(
    'dedupeKey === interaction:{conv}:discovery',
    job?.dedupeKey === `interaction:${CONV}:discovery`,
    job?.dedupeKey
  );
  check('payload.outcome === COMPLETED', job?.payload?.outcome === 'COMPLETED', job?.payload?.outcome);

  // C3: Dedupe -> segundo enqueue retorna null
  console.log('\nT007/C3: Deduplicacion (P2002)');
  const dupId = await enqueueInteractionSync({
    establishmentId: ESTAB,
    conversationId: CONV,
    stage: 'discovery',
    outcome: 'COMPLETED',
    callSummary: 'Duplicado',
    callDuration: 0,
    campaignId: 'camp-t007',
    campaignName: '[TEST] Campana T007',
  });
  check('segundo enqueue retorna null', dupId === null, String(dupId));
  const dupCount = await prisma.twentySyncJob.count({
    where: { dedupeKey: `interaction:${CONV}:discovery` },
  });
  check('solo existe 1 job con ese dedupeKey', dupCount === 1, `count=${dupCount}`);

  // C4: maxAttempts segun isConversational
  console.log('\nT007/C4: maxAttempts por tipo de outcome');
  check('COMPLETED -> maxAttempts null', job?.maxAttempts === null, String(job?.maxAttempts));

  const naId = await enqueueInteractionSync({
    establishmentId: ESTAB,
    conversationId: CONV,
    stage: 'qualification',
    outcome: 'NO_ANSWER',
    callSummary: null,
    callDuration: null,
    campaignId: 'camp-t007',
    campaignName: '[TEST] Campana T007',
  });
  if (naId) createdJobIds.push(naId);
  const naJob = naId ? await prisma.twentySyncJob.findUnique({ where: { id: naId } }) : null;
  check('NO_ANSWER -> maxAttempts 5', naJob?.maxAttempts === 5, String(naJob?.maxAttempts));

  // C5: etapa desconocida -> null
  console.log('\nT007/C5: Etapa desconocida');
  const unknownId = await enqueueInteractionSync({
    establishmentId: ESTAB,
    conversationId: CONV,
    stage: 'etapa_inexistente',
    outcome: 'COMPLETED',
  });
  check('etapa desconocida retorna null', unknownId === null, String(unknownId));

  // C6: processInteractionJob sin twentyEstablecimientoId -> throw
  console.log('\nT007/C6: processInteractionJob sin Company mapeado');
  const stateBefore = await prisma.twentySyncState.findUnique({ where: { establishmentId: ESTAB } });
  const hadCompany = stateBefore?.twentyEstablecimientoId || null;
  if (hadCompany) {
    await prisma.twentySyncState.update({
      where: { establishmentId: ESTAB },
      data: { twentyEstablecimientoId: null },
    });
  }
  let threw = false;
  try {
    await processInteractionJob(job);
  } catch (e) {
    threw = true;
  }
  check('lanza error si no hay twentyEstablecimientoId', threw);
  if (hadCompany) {
    await prisma.twentySyncState.update({
      where: { establishmentId: ESTAB },
      data: { twentyEstablecimientoId: hadCompany },
    });
  }

  // C7 + C8: E2E con Company real
  console.log('\nT007/C7/C8: E2E creacion y anclaje de Note');
  const companiesRes = await twentyService.client.get('/companies', { params: { limit: 1 } });
  const companies = companiesRes.data.data?.companies || companiesRes.data.data || [];
  if (companies.length === 0) {
    console.log('  SKIP  No hay Companies en Twenty para E2E');
  } else {
    const companyId = companies[0].id;
    let tempState = false;
    const existing = await prisma.twentySyncState.findUnique({ where: { establishmentId: ESTAB } });
    if (!existing) {
      await prisma.twentySyncState.create({
        data: { establishmentId: ESTAB, twentyEstablecimientoId: companyId },
      });
      tempState = true;
    } else if (!existing.twentyEstablecimientoId) {
      await prisma.twentySyncState.update({
        where: { establishmentId: ESTAB },
        data: { twentyEstablecimientoId: companyId },
      });
    }

    await processInteractionJob(job);
    check('processInteractionJob conversacional no lanza', true);

    const notesRes = await twentyService.client.get('/notes', {
      params: { limit: 5, order_by: 'createdAt[DescNullsLast]' },
    });
    const notes = notesRes.data.data?.notes || notesRes.data.data || [];
    const convNote = notes.find((n) => n.title === '[Discovery] Contacto realizado');
    check('C7: Note conversacional creada', !!convNote, 'no encontrada en ultimas 5');
    if (convNote) {
      createdNoteIds.push(convNote.id);
      const md = convNote.bodyV2?.markdown || '';
      check('C8: body conversacional incluye Resumen', md.includes('### Resumen'), 'sin seccion Resumen');
      check('body incluye Duracion', md.includes('**Duracion**'));
    }

    if (naJob) {
      await processInteractionJob(naJob);
      const notesRes2 = await twentyService.client.get('/notes', {
        params: { limit: 5, order_by: 'createdAt[DescNullsLast]' },
      });
      const notes2 = notesRes2.data.data?.notes || notesRes2.data.data || [];
      const naNote = notes2.find((n) => n.title === '[Qualification] Sin respuesta');
      check('C8: Note no-conversacional creada', !!naNote);
      if (naNote) {
        createdNoteIds.push(naNote.id);
        const md = naNote.bodyV2?.markdown || '';
        check('C8: body no-conversacional NO incluye Resumen', !md.includes('### Resumen'));
        check('body no-conversacional NO incluye Duracion', !md.includes('**Duracion**'));
      }
    }

    if (tempState) {
      await prisma.twentySyncState.delete({ where: { establishmentId: ESTAB } });
    } else if (!existing?.twentyEstablecimientoId) {
      await prisma.twentySyncState.update({
        where: { establishmentId: ESTAB },
        data: { twentyEstablecimientoId: null },
      });
    }
  }

  // Cleanup T007
  for (const id of createdNoteIds) {
    await twentyService.client.delete(`/notes/${id}`).catch(() => {});
  }
  await prisma.twentySyncJob.deleteMany({
    where: { dedupeKey: { startsWith: `interaction:${CONV}:` } },
  });
  console.log(`  T007 cleanup: ${createdNoteIds.length} Notes, jobs de prueba eliminados.`);
}

// ================================================================
// T008 — enqueueSync colapso PIPELINE
// ================================================================
async function runT008(ESTAB) {
  const TS = Date.now();
  const CONV_A = `t008-conv-a-${TS}`;
  const CONV_B = `t008-conv-b-${TS}`;
  const createdJobIds = [];

  await prisma.twentySyncJob.updateMany({
    where: { establishmentId: ESTAB, type: 'PIPELINE', status: { in: ['PENDING', 'PROCESSING'] } },
    data: { status: 'DONE' },
  });

  // C1: enqueueSync crea job PIPELINE
  console.log('\nT008/C1: enqueueSync crea job PIPELINE');
  const jobId1 = await enqueueSync({ establishmentId: ESTAB, partnerId: 'TEST_PARTNER', reason: 'TEST_REASON_C1' });
  if (jobId1) createdJobIds.push(jobId1);
  check('retorna jobId', !!jobId1);
  const job1 = jobId1 ? await prisma.twentySyncJob.findUnique({ where: { id: jobId1 } }) : null;
  check('job.type === PIPELINE', job1?.type === 'PIPELINE', job1?.type);
  check('job.status === PENDING', job1?.status === 'PENDING', job1?.status);
  check('job.reason === TEST_REASON_C1', job1?.reason === 'TEST_REASON_C1', job1?.reason);

  // C2: Segundo enqueueSync colapsa
  console.log('\nT008/C2: Colapso de PIPELINE');
  const jobId2 = await enqueueSync({ establishmentId: ESTAB, partnerId: 'TEST_PARTNER', reason: 'TEST_REASON_C2' });
  if (jobId2 && jobId2 !== jobId1) createdJobIds.push(jobId2);
  check('segundo enqueue retorna mismo jobId', jobId2 === jobId1, `jobId1=${jobId1} jobId2=${jobId2}`);
  const job2updated = jobId1 ? await prisma.twentySyncJob.findUnique({ where: { id: jobId1 } }) : null;
  check('reason actualizado a TEST_REASON_C2', job2updated?.reason === 'TEST_REASON_C2', job2updated?.reason);
  const pipelineCount = await prisma.twentySyncJob.count({
    where: { establishmentId: ESTAB, type: 'PIPELINE', status: { in: ['PENDING', 'PROCESSING'] } },
  });
  check('solo existe 1 PIPELINE PENDING para el establishment', pipelineCount === 1, `count=${pipelineCount}`);

  // C3: INTERACTION PENDING no bloquea colapso de PIPELINE
  console.log('\nT008/C3: INTERACTION PENDING no bloquea colapso de PIPELINE');
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

  const jobId3 = await enqueueSync({ establishmentId: ESTAB, partnerId: 'TEST_PARTNER', reason: 'TEST_REASON_C3' });
  if (jobId3 && jobId3 !== jobId1) createdJobIds.push(jobId3);
  check('tercer PIPELINE colapsa con el primero', jobId3 === jobId1, `jobId1=${jobId1} jobId3=${jobId3}`);

  const interactionStillExists = interactionId
    ? await prisma.twentySyncJob.findUnique({ where: { id: interactionId } })
    : null;
  check('INTERACTION PENDING sigue intacto', interactionStillExists?.status === 'PENDING', interactionStillExists?.status);

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

  // C4: Dos INTERACTION distintos coexisten
  console.log('\nT008/C4: Dos INTERACTION distintos coexisten sin colision');
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
  check(
    'segundo INTERACTION con distinta conv+stage retorna nuevo jobId',
    !!interactionId2 && interactionId2 !== interactionId,
    `id1=${interactionId} id2=${interactionId2}`
  );
  const bothExist =
    interactionId && interactionId2
      ? await prisma.twentySyncJob.count({
          where: { id: { in: [interactionId, interactionId2] }, type: 'INTERACTION', status: 'PENDING' },
        })
      : 0;
  check('ambos INTERACTION PENDING existen en BD', bothExist === 2, `count=${bothExist}`);

  // Cleanup T008
  await prisma.twentySyncJob.deleteMany({ where: { id: { in: createdJobIds } } });
  console.log(`  T008 cleanup: ${createdJobIds.length} jobs eliminados.`);
}

// ================================================================
// T009 — processPendingJobs bifurca por type
// ================================================================
let frozenJobs = [];

async function freezeExistingPendingJobs() {
  const farFuture = new Date('2099-01-01T00:00:00.000Z');
  const existing = await prisma.twentySyncJob.findMany({
    where: { status: 'PENDING', nextRunAt: { lte: new Date() } },
    select: { id: true, nextRunAt: true },
  });
  if (existing.length > 0) {
    await prisma.twentySyncJob.updateMany({
      where: { id: { in: existing.map((j) => j.id) } },
      data: { nextRunAt: farFuture },
    });
    frozenJobs = existing;
    console.log(`  [setup] ${existing.length} jobs existentes congelados temporalmente`);
  }
}

async function restoreFrozenJobs() {
  for (const job of frozenJobs) {
    await prisma.twentySyncJob.update({ where: { id: job.id }, data: { nextRunAt: job.nextRunAt } }).catch(() => {});
  }
  if (frozenJobs.length > 0) {
    console.log(`  [teardown] ${frozenJobs.length} jobs restaurados`);
    frozenJobs = [];
  }
}

async function runT009(ESTAB) {
  const CONV_T009 = `t009-${Date.now()}`;
  const createdJobIds = [];

  console.log('\n[setup T009] Congelando jobs PENDING existentes...');
  await freezeExistingPendingJobs();

  try {
    // C1: INTERACTION conversacional falla -> PENDING con backoff
    console.log('\nT009/C1: INTERACTION conversacional falla -> vuelve a PENDING');
    const stateC1 = await prisma.twentySyncState.findUnique({ where: { establishmentId: ESTAB } });
    const hadCompanyC1 = stateC1?.twentyEstablecimientoId || null;
    if (hadCompanyC1) {
      await prisma.twentySyncState.update({
        where: { establishmentId: ESTAB },
        data: { twentyEstablecimientoId: null },
      });
    }

    const jobC1 = await prisma.twentySyncJob.create({
      data: {
        establishmentId: ESTAB,
        type: 'INTERACTION',
        status: 'PENDING',
        reason: 'discovery:COMPLETED',
        dedupeKey: `interaction:${CONV_T009}:c1`,
        maxAttempts: null,
        payload: {
          conversationId: `${CONV_T009}-c1`,
          stage: 'discovery',
          outcome: 'COMPLETED',
          callSummary: 'Test C1 T009',
          callDuration: 60,
          campaignName: '[TEST] T009',
        },
        nextRunAt: new Date(),
      },
    });
    createdJobIds.push(jobC1.id);

    const resultC1 = await processPendingJobs(1);
    const jobC1after = await prisma.twentySyncJob.findUnique({ where: { id: jobC1.id } });

    check('processPendingJobs proceso 1 job', resultC1.processed === 1, `processed=${resultC1.processed}`);
    check('job C1 fallo (sin Company mapeado)', resultC1.failed === 1, `failed=${resultC1.failed}`);
    check('C1: maxAttempts=null -> vuelve a PENDING (no FAILED)', jobC1after?.status === 'PENDING', jobC1after?.status);
    check('C1: attempts incrementado a 1', jobC1after?.attempts === 1, `attempts=${jobC1after?.attempts}`);
    check('C1: nextRunAt > now (backoff aplicado)', jobC1after?.nextRunAt > new Date(), jobC1after?.nextRunAt?.toISOString());
    check('C1: lastError tiene contenido', !!jobC1after?.lastError, jobC1after?.lastError);

    if (hadCompanyC1) {
      await prisma.twentySyncState.update({
        where: { establishmentId: ESTAB },
        data: { twentyEstablecimientoId: hadCompanyC1 },
      });
    }

    // Congelar C1 para que no interfiera con siguientes processPendingJobs
    await prisma.twentySyncJob.update({
      where: { id: jobC1.id },
      data: { nextRunAt: new Date('2099-01-01') },
    });

    // C2: INTERACTION no-conversacional agota intentos -> FAILED
    console.log('\nT009/C2: INTERACTION no-conversacional agota intentos -> FAILED');
    const stateC2 = await prisma.twentySyncState.findUnique({ where: { establishmentId: ESTAB } });
    const hadCompanyC2 = stateC2?.twentyEstablecimientoId || null;
    if (hadCompanyC2) {
      await prisma.twentySyncState.update({
        where: { establishmentId: ESTAB },
        data: { twentyEstablecimientoId: null },
      });
    }

    const jobC2 = await prisma.twentySyncJob.create({
      data: {
        establishmentId: ESTAB,
        type: 'INTERACTION',
        status: 'PENDING',
        reason: 'qualification:NO_ANSWER',
        dedupeKey: `interaction:${CONV_T009}:c2`,
        maxAttempts: 5,
        attempts: 4,
        payload: {
          conversationId: `${CONV_T009}-c2`,
          stage: 'qualification',
          outcome: 'NO_ANSWER',
          callSummary: null,
          callDuration: null,
          campaignName: '[TEST] T009',
        },
        nextRunAt: new Date(),
      },
    });
    createdJobIds.push(jobC2.id);

    const resultC2 = await processPendingJobs(1);
    const jobC2after = await prisma.twentySyncJob.findUnique({ where: { id: jobC2.id } });

    check('C2: processPendingJobs proceso 1 job', resultC2.processed === 1, `processed=${resultC2.processed}`);
    check('C2: maxAttempts=5, attempts llega a 5 -> FAILED', jobC2after?.status === 'FAILED', jobC2after?.status);
    check('C2: attempts llego a 5', jobC2after?.attempts === 5, `attempts=${jobC2after?.attempts}`);

    if (hadCompanyC2) {
      await prisma.twentySyncState.update({
        where: { establishmentId: ESTAB },
        data: { twentyEstablecimientoId: hadCompanyC2 },
      });
    }

    // C3: Stats correctos con cola vacia
    console.log('\nT009/C3: Stats de processPendingJobs');
    const resultEmpty = await processPendingJobs(5);
    check('processPendingJobs con cola vacia retorna processed=0', resultEmpty.processed === 0, `processed=${resultEmpty.processed}`);
    check('resultado tiene campo success', typeof resultEmpty.success === 'number');
    check('resultado tiene campo failed', typeof resultEmpty.failed === 'number');

    // C4: INTERACTION exitoso con Company mapeado -> DONE
    console.log('\nT009/C4: INTERACTION exitoso con Company mapeado -> DONE');
    const companiesRes = await twentyService.client.get('/companies', { params: { limit: 1 } }).catch(() => null);
    const companies = companiesRes?.data?.data?.companies || companiesRes?.data?.data || [];

    if (companies.length === 0) {
      console.log('  SKIP  No hay Companies en Twenty');
    } else {
      const companyId = companies[0].id;
      const stateC4 = await prisma.twentySyncState.findUnique({ where: { establishmentId: ESTAB } });
      let tempState = false;
      if (!stateC4) {
        await prisma.twentySyncState.create({
          data: { establishmentId: ESTAB, twentyEstablecimientoId: companyId },
        });
        tempState = true;
      } else if (!stateC4.twentyEstablecimientoId) {
        await prisma.twentySyncState.update({
          where: { establishmentId: ESTAB },
          data: { twentyEstablecimientoId: companyId },
        });
      }

      const jobC4 = await prisma.twentySyncJob.create({
        data: {
          establishmentId: ESTAB,
          type: 'INTERACTION',
          status: 'PENDING',
          reason: 'discovery:COMPLETED',
          dedupeKey: `interaction:${CONV_T009}:c4`,
          maxAttempts: null,
          payload: {
            conversationId: `${CONV_T009}-c4`,
            stage: 'discovery',
            outcome: 'COMPLETED',
            callSummary: 'Test C4 T009 - exitoso',
            callDuration: 90,
            campaignName: '[TEST] T009 exitoso',
          },
          nextRunAt: new Date(),
        },
      });
      createdJobIds.push(jobC4.id);

      const resultC4 = await processPendingJobs(1);
      const jobC4after = await prisma.twentySyncJob.findUnique({ where: { id: jobC4.id } });

      check('C4: processPendingJobs proceso 1 job', resultC4.processed === 1, `processed=${resultC4.processed}`);
      check('C4: job exitoso -> success=1', resultC4.success === 1, `success=${resultC4.success}`);
      check('C4: job exitoso -> status DONE', jobC4after?.status === 'DONE', jobC4after?.status);
      check('C4: completedAt seteado', !!jobC4after?.completedAt, 'null');

      if (tempState) {
        await prisma.twentySyncState.delete({ where: { establishmentId: ESTAB } }).catch(() => {});
      } else if (!stateC4?.twentyEstablecimientoId) {
        await prisma.twentySyncState
          .update({ where: { establishmentId: ESTAB }, data: { twentyEstablecimientoId: null } })
          .catch(() => {});
      }
    }

    // C5: PIPELINE + INTERACTION coexisten sin cruzar rutas
    // C5: PIPELINE + INTERACTION coexisten sin cruzar rutas
    // Forzar fallo del INTERACTION limpiando el Company mapeado
    console.log('\nT009/C5: PIPELINE e INTERACTION coexisten en cola sin cruzar rutas');
    const stateC5 = await prisma.twentySyncState.findUnique({ where: { establishmentId: ESTAB } });
    const hadCompanyC5 = stateC5?.twentyEstablecimientoId || null;
    if (hadCompanyC5) {
      await prisma.twentySyncState.update({
        where: { establishmentId: ESTAB },
        data: { twentyEstablecimientoId: null },
      });
    }

    const jobPipeline = await prisma.twentySyncJob.create({
      data: {
        establishmentId: ESTAB,
        type: 'PIPELINE',
        status: 'PENDING',
        reason: 'TEST_T009_C5',
        nextRunAt: new Date(),
      },
    });
    createdJobIds.push(jobPipeline.id);

    const jobInteraction = await prisma.twentySyncJob.create({
      data: {
        establishmentId: ESTAB,
        type: 'INTERACTION',
        status: 'PENDING',
        reason: 'activation:COMPLETED',
        dedupeKey: `interaction:${CONV_T009}:c5`,
        maxAttempts: null,
        payload: {
          conversationId: `${CONV_T009}-c5`,
          stage: 'activation',
          outcome: 'COMPLETED',
          callSummary: 'Test C5',
          callDuration: 30,
          campaignName: '[TEST] T009 C5',
        },
        nextRunAt: new Date(),
      },
    });
    createdJobIds.push(jobInteraction.id);

    const resultC5 = await processPendingJobs(2);
    const [pipelineAfter, interactionAfter] = await Promise.all([
      prisma.twentySyncJob.findUnique({ where: { id: jobPipeline.id } }),
      prisma.twentySyncJob.findUnique({ where: { id: jobInteraction.id } }),
    ]);

    check('C5: ambos jobs procesados', resultC5.processed === 2, `processed=${resultC5.processed}`);
    check(
      'C5: PIPELINE fue procesado (no queda intacto)',
      pipelineAfter?.status !== 'PENDING' || pipelineAfter?.attempts > 0,
      `status=${pipelineAfter?.status}, attempts=${pipelineAfter?.attempts}`
    );
    // DONE o PENDING son validos: ambos indican que paso por processInteractionJob.
    // FAILED indicaria que fue mal enrutado (no aplica retry de INTERACTION).
    check(
      'C5: INTERACTION procesado por su handler (DONE o PENDING, no cruzado)',
      interactionAfter?.status === 'PENDING' || interactionAfter?.status === 'DONE',
      interactionAfter?.status
    );

    if (hadCompanyC5) {
      await prisma.twentySyncState.update({
        where: { establishmentId: ESTAB },
        data: { twentyEstablecimientoId: hadCompanyC5 },
      });
    }
  } finally {
    await restoreFrozenJobs();
  }

  // Cleanup T009
  const deleted = await prisma.twentySyncJob.deleteMany({ where: { id: { in: createdJobIds } } });
  console.log(`  T009 cleanup: ${deleted.count} jobs eliminados.`);
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

  console.log('=== T007: twentyActivityService ===');
  await runT007(ESTAB);

  console.log('\n=== T008: enqueueSync colapso PIPELINE ===');
  await runT008(ESTAB);

  console.log('\n=== T009: processPendingJobs bifurcacion ===');
  await runT009(ESTAB);

  console.log(`\n========================================`);
  console.log(`RESULTADO TOTAL: ${passed} PASS, ${failed} FAIL`);
  console.log(`========================================`);

  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(async (err) => {
  console.error('\nError fatal:', err.message);
  await restoreFrozenJobs().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
