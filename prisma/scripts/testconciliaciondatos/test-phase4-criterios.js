/**
 * Test Phase 4 — US2: Estado del pipeline filtrable por campaña
 * Uso: node prisma/scripts/testconciliaciondatos/test-phase4-criterios.js
 *
 * Cubre T017–T019:
 *   T017  updateCompanyFields: PATCH /companies/{id} con campos custom (ultimacampana, fechaultimallamada, totalllamadascampana)
 *   T018  processInteractionJob actualiza campos custom tras crear Note
 *   T019  GAP-2: smoke test de existencia de campos custom en la API de Twenty
 *
 * Prerequisito: Debe existir al menos un TwentySyncState con twentyEstablecimientoId no-null
 * (un Company real sincronizado con Twenty).
 */
require('dotenv').config({ quiet: true });

const prisma = require('../../../src/config/database');
const twentyService = require('../../../src/services/twenty/twentyService');
const {
  processInteractionJob,
  verifyCustomFields,
  _resetCustomFieldsVerified,
} = require('../../../src/services/twenty/twentyActivityService');
const config = require('../../../src/config/env');
const axios = require('axios');

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

// ================================================================
// T017 — updateCompanyFields: PATCH campos custom en Twenty
// ================================================================
async function runT017(companyId) {
  const testCampaignName = '[TEST] T017 Phase4';
  const testDate = new Date().toISOString();
  const testCount = 42;

  // C1: Llamada exitosa retorna respuesta de Twenty sin lanzar error
  console.log('\nT017/C1: updateCompanyFields retorna sin error');
  let response;
  let threw = false;
  try {
    response = await twentyService.updateCompanyFields(companyId, {
      ultimaCampana: testCampaignName,
      fechaUltimaLlamada: testDate,
      totalLlamadasCampana: testCount,
    });
  } catch (err) {
    threw = true;
    check('C1: no lanza error', false, err.message);
  }

  if (!threw) {
    check('C1: no lanza error', true);
    check(
      'C1: retorna un objeto (respuesta de Twenty)',
      response !== null && typeof response === 'object',
      String(response)
    );
  }

  // C2: Los campos actualizados son visibles en la respuesta
  // Twenty devuelve el Company actualizado en la respuesta del PATCH
  if (response) {
    const hasUltimaCampana =
      response.ultimacampana === testCampaignName || response.ultimaCampana === testCampaignName;
    const hasFechaUltimaLlamada = !!response.fechaultimallamada || !!response.fechaUltimaLlamada;
    const hasTotalLlamadas =
      response.totalllamadascampana === testCount || response.totalLlamadasCampana === testCount;

    check(
      'C2: respuesta incluye ultimacampana actualizado',
      hasUltimaCampana,
      JSON.stringify({
        ultimacampana: response.ultimacampana,
        ultimaCampana: response.ultimaCampana,
      })
    );
    check(
      'C2: respuesta incluye fechaultimallamada',
      hasFechaUltimaLlamada,
      JSON.stringify({ fechaultimallamada: response.fechaultimallamada })
    );
    check(
      'C2: respuesta incluye totalllamadascampana actualizado',
      hasTotalLlamadas,
      JSON.stringify({ totalllamadascampana: response.totalllamadascampana })
    );
  }

  // C3: Valores null/undefined no rompen la llamada (campos opcionales)
  console.log('\nT017/C3: updateCompanyFields acepta campos parciales (solo ultimaCampana)');
  let threw3 = false;
  try {
    await twentyService.updateCompanyFields(companyId, {
      ultimaCampana: '[TEST] T017 parcial',
      fechaUltimaLlamada: undefined,
      totalLlamadasCampana: undefined,
    });
  } catch (err) {
    threw3 = true;
    check('C3: campos parciales no lanzan error', false, err.message);
  }
  if (!threw3) {
    check('C3: campos parciales no lanzan error', true);
  }
}

// ================================================================
// T018 — processInteractionJob actualiza campos custom tras crear Note
// ================================================================
async function runT018(companyId) {
  const TS = Date.now();
  const ESTAB = `t018-estab-${TS}`;
  const CONV = `t018-conv-${TS}`;
  const CAMPAIGN_NAME = '[TEST] T018 Phase4';

  // Setup: TwentySyncState apuntando al Company de prueba
  await prisma.twentySyncState.create({
    data: { establishmentId: ESTAB, twentyEstablecimientoId: companyId },
  });

  // Crear 2 jobs INTERACTION DONE previos para que el COUNT sea 2
  const doneJobs = await Promise.all([
    prisma.twentySyncJob.create({
      data: {
        establishmentId: ESTAB, type: 'INTERACTION', status: 'DONE',
        reason: 'discovery:COMPLETED', dedupeKey: `interaction:${CONV}-prev1:discovery`,
        payload: {}, nextRunAt: new Date(),
      },
    }),
    prisma.twentySyncJob.create({
      data: {
        establishmentId: ESTAB, type: 'INTERACTION', status: 'DONE',
        reason: 'discovery:NO_ANSWER', dedupeKey: `interaction:${CONV}-prev2:discovery`,
        payload: {}, nextRunAt: new Date(),
      },
    }),
  ]);

  const job = {
    id: `fake-t018-${TS}`,
    establishmentId: ESTAB,
    payload: {
      conversationId: CONV,
      stage: 'discovery',
      outcome: 'COMPLETED',
      callSummary: 'Prueba T018 - resumen de llamada',
      callDuration: 95,
      campaignName: CAMPAIGN_NAME,
    },
  };

  // C1: processInteractionJob no lanza error con Company real
  console.log('\nT018/C1: processInteractionJob completa sin error');
  let threw = false;
  try {
    await processInteractionJob(job);
  } catch (err) {
    threw = true;
    check('C1: no lanza error', false, err.message);
  }
  if (!threw) {
    check('C1: no lanza error', true);
  }

  // C2: Verificar que el Company en Twenty tiene los campos actualizados
  console.log('\nT018/C2: campos custom actualizados en Twenty');
  const twentyClient = axios.create({
    baseURL: `${config.twenty.baseUrl}/rest`,
    headers: { Authorization: `Bearer ${config.twenty.apiKey}` },
    timeout: 10000,
  });
  const companyRes = await twentyClient.get(`/companies/${companyId}`);
  const company = companyRes.data.data?.company || companyRes.data;

  check('C2: ultimacampana actualizado', company.ultimacampana === CAMPAIGN_NAME, company.ultimacampana);
  check('C2: fechaultimallamada no es null', !!company.fechaultimallamada, String(company.fechaultimallamada));
  // COUNT de DONE al momento de ejecutar: los 2 previos (el job actual aun no esta DONE)
  check('C2: totalllamadascampana === 2', company.totalllamadascampana === 2, String(company.totalllamadascampana));

  // C3: Note fue creada en Twenty (verificar via noteTargets del Company)
  console.log('\nT018/C3: Note creada y anclada al Company en Twenty');
  const noteTargetsRes = await twentyClient.get('/noteTargets', {
    params: { limit: 10, filter: `companyId[eq]:${companyId}` },
  });
  const noteTargets = noteTargetsRes.data.data?.noteTargets || [];
  const testNoteTarget = noteTargets.find((nt) => nt.companyId === companyId);
  check('C3: NoteTarget creado y anclado al Company', !!testNoteTarget, `${noteTargets.length} noteTargets encontrados`);

  // Obtener la Note para el cleanup
  const testNoteId = testNoteTarget?.noteId;

  // Cleanup: eliminar NoteTarget, Note de Twenty, TwentySyncState y jobs de prueba
  if (testNoteId) {
    await twentyClient.delete(`/notes/${testNoteId}`).catch(() => {});
  }
  await prisma.twentySyncJob.deleteMany({ where: { id: { in: doneJobs.map((j) => j.id) } } });
  await prisma.twentySyncState.delete({ where: { establishmentId: ESTAB } });
  console.log('  T018 cleanup: done.');
}

// ================================================================
// T018 edge cases — contador no duplica en reintentos / fechaUltimaLlamada no retrocede
// ================================================================
async function runT018EdgeCases(companyId) {
  const TS = Date.now();
  const ESTAB = `t018-edge-${TS}`;
  const CONV = `t018-edge-conv-${TS}`;

  await prisma.twentySyncState.create({
    data: { establishmentId: ESTAB, twentyEstablecimientoId: companyId },
  });

  // 2 jobs DONE previos
  const doneJobs = await Promise.all([
    prisma.twentySyncJob.create({
      data: {
        establishmentId: ESTAB, type: 'INTERACTION', status: 'DONE',
        reason: 'discovery:COMPLETED', dedupeKey: `interaction:${CONV}-e1:discovery`,
        payload: {}, nextRunAt: new Date(),
      },
    }),
    prisma.twentySyncJob.create({
      data: {
        establishmentId: ESTAB, type: 'INTERACTION', status: 'DONE',
        reason: 'discovery:NO_ANSWER', dedupeKey: `interaction:${CONV}-e2:discovery`,
        payload: {}, nextRunAt: new Date(),
      },
    }),
  ]);

  const job = {
    id: `fake-t018-edge-${TS}`,
    establishmentId: ESTAB,
    payload: {
      conversationId: CONV,
      stage: 'discovery',
      outcome: 'COMPLETED',
      callSummary: 'Edge case T018',
      callDuration: 60,
      campaignName: '[TEST] T018 Edge',
    },
  };

  // Interceptar updateCompanyFields para capturar argumentos sin llamar a Twenty
  const updateCalls = [];
  const originalUpdate = twentyService.updateCompanyFields.bind(twentyService);
  twentyService.updateCompanyFields = async (cId, fields) => {
    updateCalls.push({ cId, fields, timestamp: Date.now() });
    return {};
  };
  // Interceptar createNote y createNoteTarget para no crear notas reales
  const originalCreateNote = twentyService.createNote.bind(twentyService);
  const originalCreateNoteTarget = twentyService.createNoteTarget.bind(twentyService);
  twentyService.createNote = async () => ({ id: `fake-note-${TS}` });
  twentyService.createNoteTarget = async () => ({});
  // Interceptar verifyCustomFields via mock del GET
  const realGet = twentyService.client.get.bind(twentyService.client);
  twentyService.client.get = async (url) => {
    if (url.includes('/companies/')) return { data: { data: { company: {
      id: companyId, ultimacampana: '', fechaultimallamada: null, totalllamadascampana: 0
    } } } };
    return realGet(url);
  };

  // Primer intento
  _resetCustomFieldsVerified();
  await processInteractionJob(job);
  // Segundo intento (simula reintento del worker — el job sigue PENDING, no DONE)
  _resetCustomFieldsVerified();
  await processInteractionJob(job);

  // Restaurar
  twentyService.updateCompanyFields = originalUpdate;
  twentyService.createNote = originalCreateNote;
  twentyService.createNoteTarget = originalCreateNoteTarget;
  twentyService.client.get = realGet;

  // Edge case 1: contador no duplica en reintentos
  console.log('\nT018-EC1: totalLlamadasCampana no sube en reintento');
  check('EC1: updateCompanyFields llamado 2 veces (1 por intento)', updateCalls.length === 2, String(updateCalls.length));
  const count1 = updateCalls[0]?.fields?.totalLlamadasCampana;
  const count2 = updateCalls[1]?.fields?.totalLlamadasCampana;
  check('EC1: primer intento envia count=2', count1 === 2, String(count1));
  check('EC1: reintento envia mismo count=2 (no duplica)', count2 === 2, String(count2));

  // Edge case 2: fechaUltimaLlamada no retrocede en reintento
  console.log('\nT018-EC2: fechaUltimaLlamada no retrocede en reintento');
  const fecha1 = new Date(updateCalls[0]?.fields?.fechaUltimaLlamada).getTime();
  const fecha2 = new Date(updateCalls[1]?.fields?.fechaUltimaLlamada).getTime();
  check('EC2: ambos intentos envian fecha no-null', !isNaN(fecha1) && !isNaN(fecha2), `${updateCalls[0]?.fields?.fechaUltimaLlamada} / ${updateCalls[1]?.fields?.fechaUltimaLlamada}`);
  check('EC2: fecha del reintento >= fecha del primer intento (no retrocede)', fecha2 >= fecha1, `${fecha1} vs ${fecha2}`);

  // Cleanup
  await prisma.twentySyncJob.deleteMany({ where: { id: { in: doneJobs.map((j) => j.id) } } });
  await prisma.twentySyncState.delete({ where: { establishmentId: ESTAB } });
  console.log('  T018 edge cases cleanup: done.');
}

// ================================================================
// T019 — GAP-2: smoke test de existencia de campos custom en Twenty
// ================================================================
async function runT019(companyId) {
  const logger = require('../../../src/config/logger');

  // C1: Campos existen -> no se loguea error, flag queda en true
  console.log('\nT019/C1: Campos custom existen -> no error, flag customFieldsVerified=true');
  _resetCustomFieldsVerified();

  const errorsC1 = [];
  const origError = logger.error.bind(logger);
  logger.error = (...args) => { errorsC1.push(args); origError(...args); };

  await verifyCustomFields(companyId);
  logger.error = origError;

  const customFieldError = errorsC1.find(
    (a) => typeof a[0] === 'string' && a[0].includes('Campo custom inexistente')
  );
  check('C1: no loguea error de campo inexistente', !customFieldError, customFieldError?.[0]);

  // C2: Campos faltan -> loguea error con mensaje correcto y campos faltantes
  console.log('\nT019/C2: Campos custom faltantes -> logger.error con mensaje CRM-855');
  _resetCustomFieldsVerified();

  // Mock: GET /companies devuelve objeto sin los campos custom
  const realGet = twentyService.client.get.bind(twentyService.client);
  twentyService.client.get = async (url) => {
    if (url.includes('/companies/')) return { data: { data: { company: { id: companyId, name: 'Negocio Prueba' } } } };
    return realGet(url);
  };

  const errorsC2 = [];
  logger.error = (...args) => { errorsC2.push(args); origError(...args); };

  await verifyCustomFields(companyId);
  logger.error = origError;
  twentyService.client.get = realGet;

  const missingError = errorsC2.find(
    (a) => typeof a[0] === 'string' && a[0].includes('Campo custom inexistente')
  );
  check('C2: loguea error de campo inexistente', !!missingError, 'no se encontro el error esperado');
  check(
    'C2: mensaje menciona CRM-855',
    missingError?.[0]?.includes('CRM-855'),
    missingError?.[0]
  );
  const missingFields = missingError?.[1]?.missing || [];
  check(
    'C2: reporta los 3 campos faltantes',
    missingFields.length === 3,
    JSON.stringify(missingFields)
  );

  // C3: Con campos faltantes, flag NO se setea (reintentara en la proxima llamada)
  _resetCustomFieldsVerified();
  twentyService.client.get = async (url) => {
    if (url.includes('/companies/')) return { data: { data: { company: { id: companyId } } } };
    return realGet(url);
  };
  await verifyCustomFields(companyId);
  twentyService.client.get = realGet;

  // Verificar que el flag sigue en false accediendo al modulo directamente
  // (lo verificamos indirectamente: si customFieldsVerified fuera true, la proxima
  //  llamada a verifyCustomFields no loguea nada aunque los campos falten)
  const errorsC3 = [];
  logger.error = (...args) => { errorsC3.push(args); origError(...args); };
  twentyService.client.get = async (url) => {
    if (url.includes('/companies/')) return { data: { data: { company: { id: companyId } } } };
    return realGet(url);
  };
  await verifyCustomFields(companyId);
  logger.error = origError;
  twentyService.client.get = realGet;

  const stillLogs = errorsC3.find((a) => typeof a[0] === 'string' && a[0].includes('Campo custom inexistente'));
  check('C3: flag no se setea con campos faltantes (reintenta proxima vez)', !!stillLogs, 'no reintento la verificacion');

  // C4: Con campos ausentes, processInteractionJob completa sin throw (job queda DONE, no FAILED)
  console.log('\nT019/C4: Campos ausentes -> processInteractionJob no lanza (job procesado como DONE)');
  _resetCustomFieldsVerified();

  const TS = Date.now();
  const ESTAB_C4 = `t019-c4-${TS}`;
  await prisma.twentySyncState.create({
    data: { establishmentId: ESTAB_C4, twentyEstablecimientoId: companyId },
  });

  // Mock: campos ausentes en GET + createNote/createNoteTarget sin llamada real
  twentyService.client.get = async (url) => {
    if (url.includes('/companies/')) return { data: { data: { company: { id: companyId } } } };
    return realGet(url);
  };
  const origCreateNote = twentyService.createNote.bind(twentyService);
  const origCreateNoteTarget = twentyService.createNoteTarget.bind(twentyService);
  twentyService.createNote = async () => ({ id: `fake-note-c4-${TS}` });
  twentyService.createNoteTarget = async () => ({});

  let threwC4 = false;
  try {
    await processInteractionJob({
      id: `fake-c4-${TS}`,
      establishmentId: ESTAB_C4,
      payload: { conversationId: `c4-conv-${TS}`, stage: 'discovery', outcome: 'NO_ANSWER', callSummary: null, callDuration: null, campaignName: null },
    });
  } catch (err) {
    threwC4 = true;
  } finally {
    twentyService.client.get = realGet;
    twentyService.createNote = origCreateNote;
    twentyService.createNoteTarget = origCreateNoteTarget;
  }

  check('C4: no lanza error aunque campos esten ausentes (job = DONE, no FAILED)', !threwC4, 'lanzo un error');

  await prisma.twentySyncState.delete({ where: { establishmentId: ESTAB_C4 } });

  // Restaurar flag para dejar el modulo en estado limpio
  _resetCustomFieldsVerified();
}

// ================================================================
// Main
// ================================================================
async function run() {
  if (!twentyService.isEnabled()) {
    console.error('Twenty CRM no esta habilitado (TWENTY_API_KEY o TWENTY_SYNC_ENABLED faltante).');
    process.exit(1);
  }

  // Acepta companyId como argumento CLI o lo busca en BD
  const argCompanyId = process.argv[2];
  let companyId;

  if (argCompanyId) {
    companyId = argCompanyId;
    console.log(`Usando companyId por argumento CLI: ${companyId}`);
  } else {
    const syncState = await prisma.twentySyncState.findFirst({
      where: { twentyEstablecimientoId: { not: null } },
      select: { twentyEstablecimientoId: true, establishmentId: true },
    });

    if (!syncState) {
      console.error('No hay TwentySyncState con twentyEstablecimientoId.');
      console.error('Pasa el companyId de Twenty como argumento: node test-phase4-criterios.js <companyId>');
      process.exit(1);
    }

    companyId = syncState.twentyEstablecimientoId;
    console.log(`Usando companyId de BD: ${companyId} (estab: ${syncState.establishmentId})`);
  }

  console.log('\n=== T017: updateCompanyFields ===');
  await runT017(companyId);

  console.log('\n=== T018: processInteractionJob actualiza campos custom ===');
  await runT018(companyId);

  console.log('\n=== T018 Edge Cases: contador / fechaUltimaLlamada ===');
  await runT018EdgeCases(companyId);

  console.log('\n=== T019: GAP-2 smoke test campos custom en Twenty ===');
  await runT019(companyId);

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
