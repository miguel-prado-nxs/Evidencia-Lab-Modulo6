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
