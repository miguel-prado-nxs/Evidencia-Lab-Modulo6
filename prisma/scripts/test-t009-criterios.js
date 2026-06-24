/**
 * Test de criterios T009 — processPendingJobs bifurca por job.type
 * Uso: node prisma/scripts/test-t009-criterios.js
 *
 * Estrategia: congela jobs PENDING existentes moviéndolos a nextRunAt futuro,
 * crea jobs de prueba, ejecuta processPendingJobs, verifica resultados, restaura.
 *
 * Criterios cubiertos:
 *   C1  Job INTERACTION conversacional (maxAttempts=null) falla -> vuelve a PENDING con backoff
 *   C2  Job INTERACTION no-conversacional (maxAttempts=5) con attempts=4 falla -> pasa a FAILED
 *   C3  processPendingJobs retorna { processed, success, failed } con valores correctos
 *   C4  Job INTERACTION exitoso (con Company mapeado) -> pasa a DONE
 *   C5  PIPELINE y INTERACTION en cola -> ambos procesados segun su tipo
 */
require('dotenv').config({ quiet: true });
const prisma = require('../../src/config/database');
const twentyService = require('../../src/services/twenty/twentyService');
const { processPendingJobs } = require('../../src/services/twenty/twentySyncService');

let passed = 0;
let failed = 0;
const createdJobIds = [];
let frozenJobs = []; // jobs congelados para no interferir en los tests

function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ' -> ' + detail : ''}`);
  }
}

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
    await prisma.twentySyncJob
      .update({
        where: { id: job.id },
        data: { nextRunAt: job.nextRunAt },
      })
      .catch(() => {});
  }
  if (frozenJobs.length > 0) {
    console.log(`  [teardown] ${frozenJobs.length} jobs restaurados`);
  }
}

async function run() {
  const CONV_T009 = `t009-${Date.now()}`;

  // Obtener un establishmentId real
  const enrichment = await prisma.establishmentEnrichment.findFirst({
    select: { establishmentId: true },
  });
  if (!enrichment) {
    console.error('No hay EstablishmentEnrichment en la BD. Aborto.');
    process.exit(1);
  }
  const ESTAB = enrichment.establishmentId;

  // Congelar jobs pendientes existentes para no interferir
  console.log('\n[setup] Congelando jobs PENDING existentes...');
  await freezeExistingPendingJobs();

  try {
    // ============================================================
    // C1: INTERACTION conversacional (maxAttempts=null) falla -> PENDING con backoff
    // ============================================================
    console.log('\nC1: INTERACTION conversacional falla -> vuelve a PENDING');

    // Forzar fallo: no hay TwentySyncState con company para este establishment
    // (El processInteractionJob lanza error si no encuentra twentyEstablecimientoId)
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
        maxAttempts: null, // conversacional -> reintentar indefinidamente
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

    check('processPendingJobs procesó 1 job', resultC1.processed === 1, `processed=${resultC1.processed}`);
    check('job C1 falló (sin Company mapeado)', resultC1.failed === 1, `failed=${resultC1.failed}`);
    check(
      'C1: maxAttempts=null -> vuelve a PENDING (no FAILED)',
      jobC1after?.status === 'PENDING',
      jobC1after?.status
    );
    check('C1: attempts incrementado a 1', jobC1after?.attempts === 1, `attempts=${jobC1after?.attempts}`);
    check(
      'C1: nextRunAt > now (backoff aplicado)',
      jobC1after?.nextRunAt > new Date(),
      jobC1after?.nextRunAt?.toISOString()
    );
    check('C1: lastError tiene contenido', !!jobC1after?.lastError, jobC1after?.lastError);

    // Restaurar company si lo limpiamos
    if (hadCompanyC1) {
      await prisma.twentySyncState.update({
        where: { establishmentId: ESTAB },
        data: { twentyEstablecimientoId: hadCompanyC1 },
      });
    }

    // ============================================================
    // C2: INTERACTION no-conversacional (maxAttempts=5, attempts=4) falla -> FAILED
    // ============================================================
    console.log('\nC2: INTERACTION no-conversacional agota intentos -> FAILED');

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
        attempts: 4, // Ya tiene 4 intentos previos -> el siguiente (5to) agota el limite
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

    check('C2: processPendingJobs procesó 1 job', resultC2.processed === 1, `processed=${resultC2.processed}`);
    check(
      'C2: maxAttempts=5, attempts llega a 5 -> FAILED',
      jobC2after?.status === 'FAILED',
      jobC2after?.status
    );
    check('C2: attempts llego a 5', jobC2after?.attempts === 5, `attempts=${jobC2after?.attempts}`);

    if (hadCompanyC2) {
      await prisma.twentySyncState.update({
        where: { establishmentId: ESTAB },
        data: { twentyEstablecimientoId: hadCompanyC2 },
      });
    }

    // ============================================================
    // C3: processPendingJobs retorna stats correctos
    // ============================================================
    console.log('\nC3: Stats de processPendingJobs');

    // Ya validados en C1 y C2 parcialmente. Crear un caso de 0 jobs pendientes.
    const resultEmpty = await processPendingJobs(5);
    check(
      'processPendingJobs con cola vacia retorna processed=0',
      resultEmpty.processed === 0,
      `processed=${resultEmpty.processed}`
    );
    check('resultado tiene campo success', typeof resultEmpty.success === 'number');
    check('resultado tiene campo failed', typeof resultEmpty.failed === 'number');

    // ============================================================
    // C4: INTERACTION con Company mapeado -> pasa a DONE
    //     Solo ejecutar si hay un Company en Twenty disponible
    // ============================================================
    console.log('\nC4: INTERACTION exitoso con Company mapeado -> DONE');

    const companiesRes = await twentyService.client
      .get('/companies', { params: { limit: 1 } })
      .catch(() => null);
    const companies = companiesRes?.data?.data?.companies || companiesRes?.data?.data || [];

    if (companies.length === 0) {
      console.log('  SKIP  No hay Companies en Twenty (entorno sin conectividad o sin datos)');
    } else {
      const companyId = companies[0].id;

      // Mapear temporalmente el establishment al Company
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

      check('C4: processPendingJobs procesó 1 job', resultC4.processed === 1, `processed=${resultC4.processed}`);
      check('C4: job exitoso -> success=1', resultC4.success === 1, `success=${resultC4.success}`);
      check('C4: job exitoso -> status DONE', jobC4after?.status === 'DONE', jobC4after?.status);
      check('C4: completedAt seteado', !!jobC4after?.completedAt, 'null');

      // Limpiar estado temporal
      if (tempState) {
        await prisma.twentySyncState.delete({ where: { establishmentId: ESTAB } }).catch(() => {});
      } else if (!stateC4?.twentyEstablecimientoId) {
        await prisma.twentySyncState
          .update({ where: { establishmentId: ESTAB }, data: { twentyEstablecimientoId: null } })
          .catch(() => {});
      }
    }

    // ============================================================
    // C5: PIPELINE y INTERACTION en cola -> cada uno procesado por su rama
    //     (Verificamos que INTERACTION con falla va a PENDING y PIPELINE a PIPELINE)
    //     Sin conexión real a Twenty, ambos fallarán pero por razones distintas.
    // ============================================================
    console.log('\nC5: PIPELINE e INTERACTION coexisten en cola sin cruzar rutas');

    // Crear job PIPELINE que fallará (el establishment puede no estar en Twenty)
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

    // Crear job INTERACTION que fallará (no hay Company mapeado para este test)
    const stateC5 = await prisma.twentySyncState.findUnique({ where: { establishmentId: ESTAB } });
    const hadCompanyC5 = stateC5?.twentyEstablecimientoId || null;
    if (hadCompanyC5) {
      await prisma.twentySyncState.update({
        where: { establishmentId: ESTAB },
        data: { twentyEstablecimientoId: null },
      });
    }

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

    // Procesar los dos jobs
    const resultC5 = await processPendingJobs(2);
    const [pipelineAfter, interactionAfter] = await Promise.all([
      prisma.twentySyncJob.findUnique({ where: { id: jobPipeline.id } }),
      prisma.twentySyncJob.findUnique({ where: { id: jobInteraction.id } }),
    ]);

    check('C5: ambos jobs procesados', resultC5.processed === 2, `processed=${resultC5.processed}`);
    // El PIPELINE puede quedar DONE, FAILED o PENDING según si llega a Twenty o no
    check(
      'C5: PIPELINE no queda en PENDING con status=PENDING inicial (fue procesado)',
      pipelineAfter?.status !== 'PENDING' || pipelineAfter?.attempts > 0,
      `status=${pipelineAfter?.status}, attempts=${pipelineAfter?.attempts}`
    );
    // El INTERACTION conversacional vuelve a PENDING (maxAttempts=null)
    check(
      'C5: INTERACTION conversacional vuelve a PENDING (no FAILED)',
      interactionAfter?.status === 'PENDING',
      interactionAfter?.status
    );

    if (hadCompanyC5) {
      await prisma.twentySyncState.update({
        where: { establishmentId: ESTAB },
        data: { twentyEstablecimientoId: hadCompanyC5 },
      });
    }
  } finally {
    // Siempre restaurar jobs congelados
    await restoreFrozenJobs();
  }

  // ============================================================
  // Cleanup de jobs de prueba
  // ============================================================
  console.log('\nLimpiando jobs de prueba...');
  const deleted = await prisma.twentySyncJob.deleteMany({
    where: { id: { in: createdJobIds } },
  });
  console.log(`  ${deleted.count} jobs eliminados.`);

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
  await restoreFrozenJobs().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
