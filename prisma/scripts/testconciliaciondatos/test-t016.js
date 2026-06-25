/**
 * Test T016 — Manejo de Company inexistente en processInteractionJob
 * Uso: node prisma/scripts/testconciliaciondatos/test-t016.js
 *
 * Criterios:
 *   C1: Sin TwentySyncState -> lanza Error (worker reintenta, correcto)
 *   C2: TwentySyncState existe pero twentyEstablecimientoId=null -> retorna sin throw (skip silencioso)
 *   C3: C2 llama logger.error con jobId, establishmentId, stage, outcome
 */
require('dotenv').config({ quiet: true });

const prisma = require('../../../src/config/database');
const logger = require('../../../src/config/logger');
const { processInteractionJob } = require('../../../src/services/twenty/twentyActivityService');

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

async function run() {
  const TS = Date.now();
  // IDs ficticios — no necesitan existir en establishments para este test
  const ESTAB_NO_STATE = `t016-nostate-${TS}`;
  const ESTAB_NULL_ID  = `t016-nullid-${TS}`;

  // Asegurarse de que no existen estados previos
  await prisma.twentySyncState.deleteMany({
    where: { establishmentId: { in: [ESTAB_NO_STATE, ESTAB_NULL_ID] } },
  });

  // Setup: crear TwentySyncState con twentyEstablecimientoId=null para C2/C3
  await prisma.twentySyncState.create({
    data: {
      establishmentId: ESTAB_NULL_ID,
      twentyEstablecimientoId: null,
    },
  });

  const makeJob = (establishmentId) => ({
    id: `fake-job-${TS}`,
    establishmentId,
    payload: {
      conversationId: `conv-${TS}`,
      stage: 'discovery',
      outcome: 'NO_ANSWER',
      callSummary: null,
      callDuration: null,
      campaignName: null,
    },
  });

  // ================================================================
  // C1: Sin TwentySyncState -> debe lanzar Error
  // ================================================================
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
  check(
    'C1: mensaje menciona TwentySyncState',
    errorMsgC1.includes('TwentySyncState') || errorMsgC1.includes(ESTAB_NO_STATE),
    errorMsgC1,
  );

  // ================================================================
  // C2 + C3: TwentySyncState existe con twentyEstablecimientoId=null -> skip silencioso
  // ================================================================
  console.log('\nT016/C2/C3: TwentySyncState con companyId=null -> no throw, logger.error llamado');

  // Interceptar logger.error para verificar C3
  const loggerErrorCalls = [];
  const originalLoggerError = logger.error.bind(logger);
  logger.error = (...args) => {
    loggerErrorCalls.push(args);
    originalLoggerError(...args);
  };

  let threwC2 = false;
  let returnValueC2;
  try {
    returnValueC2 = await processInteractionJob(makeJob(ESTAB_NULL_ID));
  } catch (err) {
    threwC2 = true;
  } finally {
    logger.error = originalLoggerError; // restaurar
  }

  check('C2: no lanza Error (retorna sin throw)', !threwC2, 'lanzo un error');
  check('C2: retorna undefined (skip limpio)', returnValueC2 === undefined, String(returnValueC2));

  const relevantLog = loggerErrorCalls.find(
    (args) => typeof args[0] === 'string' && args[0].includes('processInteractionJob'),
  );
  check('C3: logger.error fue llamado', !!relevantLog, 'no se encontro llamada a logger.error');

  if (relevantLog) {
    const meta = relevantLog[1] || {};
    check('C3: log incluye jobId', 'jobId' in meta, JSON.stringify(meta));
    check('C3: log incluye establishmentId', meta.establishmentId === ESTAB_NULL_ID, meta.establishmentId);
    check('C3: log incluye stage', 'stage' in meta, JSON.stringify(meta));
    check('C3: log incluye outcome', 'outcome' in meta, JSON.stringify(meta));
  }

  // Cleanup
  await prisma.twentySyncState.deleteMany({
    where: { establishmentId: { in: [ESTAB_NO_STATE, ESTAB_NULL_ID] } },
  });
  console.log('  T016 cleanup: done.');

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
