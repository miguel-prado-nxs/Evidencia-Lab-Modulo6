/**
 * Test de criterios T007 — twentyActivityService
 * Uso: node prisma/scripts/test-t007-criterios.js
 *
 * Valida cada criterio de la task por separado con asserts etiquetados.
 * Limpia todos los datos de prueba al final (jobs + Note + state temporal).
 *
 * Criterios cubiertos:
 *   C1  STAGE_CONFIG tiene las 6 etapas esperadas
 *   C2  enqueueInteractionSync crea job type=INTERACTION con dedupeKey correcto
 *   C3  Dedupe: segundo enqueue (mismo conversationId+stage) retorna null (P2002)
 *   C4  maxAttempts: outcome conversacional -> null; no-conversacional -> 5
 *   C5  Etapa desconocida -> retorna null sin crear job
 *   C6  processInteractionJob sin twentyEstablecimientoId -> lanza error (para reintento)
 *   C7  E2E: processInteractionJob crea Note y la ancla al Company real
 *   C8  Body: conversacional incluye Resumen; no-conversacional NO lo incluye
 */
require('dotenv').config({ quiet: true });
const prisma = require('../../src/config/database');
const twentyService = require('../../src/services/twenty/twentyService');
const {
  STAGE_CONFIG,
  enqueueInteractionSync,
  processInteractionJob,
} = require('../../src/services/twenty/twentyActivityService');

// ---- mini framework de asserts ----
let passed = 0;
let failed = 0;
const createdJobIds = [];
const createdNoteIds = [];

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
  const CONV = `t007-${Date.now()}`;

  // ============================================================
  // C1: STAGE_CONFIG tiene las 6 etapas
  // ============================================================
  console.log('\nC1: STAGE_CONFIG');
  const expectedStages = [
    'discovery',
    'qualification',
    'activation',
    'conversion',
    'coupon_sent',
    'coupon_redeemed',
  ];
  for (const s of expectedStages) {
    check(`etapa "${s}" existe`, !!STAGE_CONFIG[s], `STAGE_CONFIG[${s}] indefinido`);
  }
  check(
    'discovery tiene stageLabel/isConversational/outcomeLabels',
    STAGE_CONFIG.discovery?.stageLabel &&
      typeof STAGE_CONFIG.discovery?.isConversational === 'function' &&
      STAGE_CONFIG.discovery?.outcomeLabels
  );

  // ============================================================
  // C2: enqueueInteractionSync crea job con dedupeKey correcto
  // ============================================================
  console.log('\nC2: enqueueInteractionSync crea job INTERACTION');
  // Necesita un establishmentId real (FK). Tomamos el primero de enrichment.
  const enrichment = await prisma.establishmentEnrichment.findFirst({
    select: { establishmentId: true },
  });
  if (!enrichment) {
    console.error('No hay EstablishmentEnrichment en la BD. Aborto.');
    process.exit(1);
  }
  const ESTAB = enrichment.establishmentId;

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

  // ============================================================
  // C3: Dedupe -> segundo enqueue retorna null
  // ============================================================
  console.log('\nC3: Deduplicacion (P2002)');
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

  // ============================================================
  // C4: maxAttempts segun isConversational
  // ============================================================
  console.log('\nC4: maxAttempts por tipo de outcome');
  // Conversacional (COMPLETED) -> null
  check('COMPLETED -> maxAttempts null', job?.maxAttempts === null, String(job?.maxAttempts));

  // No-conversacional (NO_ANSWER) -> 5, en otra etapa para no chocar dedupe
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

  // ============================================================
  // C5: etapa desconocida -> null
  // ============================================================
  console.log('\nC5: Etapa desconocida');
  const unknownId = await enqueueInteractionSync({
    establishmentId: ESTAB,
    conversationId: CONV,
    stage: 'etapa_inexistente',
    outcome: 'COMPLETED',
  });
  check('etapa desconocida retorna null', unknownId === null, String(unknownId));

  // ============================================================
  // C6: processInteractionJob sin twentyEstablecimientoId -> throw
  // ============================================================
  console.log('\nC6: processInteractionJob sin Company mapeado');
  // Asegurar que NO haya TwentySyncState con company para este establishment
  const stateBefore = await prisma.twentySyncState.findUnique({ where: { establishmentId: ESTAB } });
  const hadCompany = stateBefore?.twentyEstablecimientoId || null;
  if (hadCompany) {
    // Lo limpiamos temporalmente para forzar el escenario
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
  // Restaurar
  if (hadCompany) {
    await prisma.twentySyncState.update({
      where: { establishmentId: ESTAB },
      data: { twentyEstablecimientoId: hadCompany },
    });
  }

  // ============================================================
  // C7 + C8: E2E con Company real -> Note creada y anclada
  // ============================================================
  console.log('\nC7/C8: E2E creacion y anclaje de Note');
  // Obtener un Company real de Twenty
  const companiesRes = await twentyService.client.get('/companies', { params: { limit: 1 } });
  const companies = companiesRes.data.data?.companies || companiesRes.data.data || [];
  if (companies.length === 0) {
    console.log('  SKIP  No hay Companies en Twenty para E2E');
  } else {
    const companyId = companies[0].id;
    // Mapear temporalmente el establishment al Company
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

    // Procesar el job conversacional (COMPLETED) -> debe incluir Resumen
    await processInteractionJob(job);
    check('processInteractionJob conversacional no lanza', true);

    // Buscar la Note creada
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

    // Procesar job NO_ANSWER -> NO debe incluir Resumen
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

    // limpiar state temporal
    if (tempState) {
      await prisma.twentySyncState.delete({ where: { establishmentId: ESTAB } });
    } else if (!existing?.twentyEstablecimientoId) {
      await prisma.twentySyncState.update({
        where: { establishmentId: ESTAB },
        data: { twentyEstablecimientoId: null },
      });
    }
  }

  // ============================================================
  // Cleanup
  // ============================================================
  console.log('\nLimpiando datos de prueba...');
  for (const id of createdNoteIds) {
    await twentyService.client.delete(`/notes/${id}`).catch(() => {});
  }
  await prisma.twentySyncJob.deleteMany({
    where: { dedupeKey: { startsWith: `interaction:${CONV}:` } },
  });
  console.log(`  ${createdNoteIds.length} Notes eliminadas, jobs de prueba eliminados.`);

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
