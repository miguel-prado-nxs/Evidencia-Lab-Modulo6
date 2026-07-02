/**
 * Test manual de twentyActivityService (T007)
 * Uso: node prisma/scripts/test-activity-service.js [--cleanup]
 *
 * Requisitos:
 *   - Al menos un TwentySyncState con twentyEstablecimientoId no nulo
 *   - TWENTY_API_KEY y DATABASE_URL en .env
 *
 * Con --cleanup elimina el job y la Note creados al final.
 */
require('dotenv').config();
const prisma = require('../../src/config/database');
const { enqueueInteractionSync, processInteractionJob } = require('../../src/services/twenty/twentyActivityService');
const twentyService = require('../../src/services/twenty/twentyService');

const CLEANUP = process.argv.includes('--cleanup');

// ID unico para no colisionar con datos reales
const TEST_CONVERSATION_ID = `test-t007-${Date.now()}`;

async function run() {
  // 1. Buscar un establecimiento con Twenty ID mapeado
  console.log('1. Buscando TwentySyncState con twentyEstablecimientoId...');
  let syncState = await prisma.twentySyncState.findFirst({
    where: { twentyEstablecimientoId: { not: null } },
    select: { establishmentId: true, twentyEstablecimientoId: true },
  });

  let tempSyncStateCreated = false;

  if (!syncState) {
    console.log('   No hay TwentySyncState existente — creando uno temporal para el test...');

    // Obtener el primer Company disponible en Twenty
    const companiesRes = await twentyService.client.get('/companies', { params: { limit: 1 } });
    const companies = companiesRes.data.data?.companies || companiesRes.data.data || [];
    if (companies.length === 0) {
      console.error('   No hay Companies en Twenty. Crea al menos uno primero.');
      process.exit(1);
    }
    const twentyCompanyId = companies[0].id;
    console.log('   Company en Twenty:', twentyCompanyId, `(${companies[0].name})`);

    // Obtener el primer EstablishmentEnrichment disponible
    const enrichment = await prisma.establishmentEnrichment.findFirst({
      select: { establishmentId: true },
    });
    if (!enrichment) {
      console.error('   No hay EstablishmentEnrichment en la BD. El sistema no tiene datos de establecimientos.');
      process.exit(1);
    }
    console.log('   establishmentId local:', enrichment.establishmentId);

    // Crear TwentySyncState temporal
    syncState = await prisma.twentySyncState.upsert({
      where: { establishmentId: enrichment.establishmentId },
      create: {
        establishmentId: enrichment.establishmentId,
        twentyEstablecimientoId: twentyCompanyId,
      },
      update: {
        twentyEstablecimientoId: twentyCompanyId,
      },
      select: { establishmentId: true, twentyEstablecimientoId: true },
    });

    tempSyncStateCreated = true;
    console.log('   TwentySyncState temporal creado.');
  }

  console.log('   establishmentId:', syncState.establishmentId);
  console.log('   twentyEstablecimientoId:', syncState.twentyEstablecimientoId);

  // 2. Encolar job INTERACTION
  console.log('\n2. Llamando enqueueInteractionSync (stage=discovery, outcome=FOLLOW_UP_LATER)...');
  const jobId = await enqueueInteractionSync({
    establishmentId: syncState.establishmentId,
    conversationId: TEST_CONVERSATION_ID,
    stage: 'discovery',
    outcome: 'FOLLOW_UP_LATER',
    callSummary: 'El cliente mostro interes pero pidio que lo llamaran la proxima semana. Mencionó que ya usa un sistema de punto de venta pero que esta abierto a una demo.',
    callDuration: 127,
    campaignId: 'campaign-test-t007',
    campaignName: '[TEST] Campana T007',
  });

  if (!jobId) {
    console.error('   enqueueInteractionSync retorno null — revisar logs.');
    process.exit(1);
  }
  console.log('   jobId creado:', jobId);

  // 3. Verificar deduplicacion (segunda llamada con mismo conversationId debe ser ignorada)
  console.log('\n3. Probando deduplicacion (mismo conversationId+stage)...');
  const duplicateJobId = await enqueueInteractionSync({
    establishmentId: syncState.establishmentId,
    conversationId: TEST_CONVERSATION_ID,
    stage: 'discovery',
    outcome: 'FOLLOW_UP_LATER',
    callSummary: 'Duplicado — no debe crear otro job',
    callDuration: 0,
    campaignId: 'campaign-test-t007',
    campaignName: '[TEST] Campana T007',
  });

  if (duplicateJobId === null) {
    console.log('   OK: duplicado omitido correctamente (retorno null).');
  } else {
    console.warn('   ADVERTENCIA: se creo un segundo job cuando no debia:', duplicateJobId);
  }

  // 4. Procesar el job directamente (sin esperar al worker)
  console.log('\n4. Llamando processInteractionJob...');
  const job = await prisma.twentySyncJob.findUnique({ where: { id: jobId } });

  if (!job) {
    console.error('   Job no encontrado en BD.');
    process.exit(1);
  }

  await processInteractionJob(job);
  console.log('   processInteractionJob completado sin errores.');

  // 5. Verificar que la Note existe en Twenty
  console.log('\n5. Verificando Note en Twenty...');
  const notesRes = await twentyService.client.get('/notes', { params: { limit: 5, order_by: 'createdAt[DescNullsLast]' } });
  const notes = notesRes.data.data?.notes || notesRes.data.data || [];
  const testNote = notes.find((n) => n.title && n.title.includes('[Discovery] Seguimiento posterior'));

  if (testNote) {
    console.log('   OK: Note encontrada en Twenty.');
    console.log('   noteId:', testNote.id);
    console.log('   title:', testNote.title);
  } else {
    console.warn('   Note no encontrada en las ultimas 5 — puede haber tardado o el filtro no coincidio.');
    console.warn('   Verifica manualmente en Twenty el Company del establecimiento.');
  }

  const baseUrl = process.env.TWENTY_BASE_URL?.replace('/api', '');
  console.log('\nVerifica la Note en el timeline del Company:');
  console.log(baseUrl + '/objects/companies/' + syncState.twentyEstablecimientoId);

  // 6. Cleanup opcional
  if (CLEANUP) {
    console.log('\n6. Limpiando...');
    if (testNote) {
      await twentyService.client.delete(`/notes/${testNote.id}`);
      console.log('   Note eliminada de Twenty.');
    }
    await prisma.twentySyncJob.delete({ where: { id: jobId } });
    console.log('   Job eliminado de BD.');
    if (tempSyncStateCreated) {
      await prisma.twentySyncState.update({
        where: { establishmentId: syncState.establishmentId },
        data: { twentyEstablecimientoId: null },
      });
      console.log('   TwentySyncState temporal revertido.');
    }
  }

  await prisma.$disconnect();
}

run().catch(async (err) => {
  console.error('\nError:', err.message);
  await prisma.$disconnect();
  process.exit(1);
});
