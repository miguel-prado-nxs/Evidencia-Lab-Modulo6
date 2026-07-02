/**
 * Test manual de createNote + createNoteTarget (T005 + T006)
 * Uso: node prisma/scripts/test-create-note.js [--cleanup]
 * Con --cleanup elimina la Note al final (el noteTarget se elimina en cascada)
 */
require('dotenv').config();
const twentyService = require('../../src/services/twenty/twentyService');

const CLEANUP = process.argv.includes('--cleanup');

async function getFirstCompanyId() {
  const res = await twentyService.client.get('/companies', { params: { limit: 1 } });
  const companies = res.data.data?.companies || res.data.data || [];
  return companies[0]?.id || null;
}

async function run() {
  // --- T005: createNote ---
  const title = '[TEST] createNote T005/T006 — ' + new Date().toLocaleString('es-MX');
  const body = '**Campaña**: Test manual T006\n**Etapa**: Discovery\n**Resultado**: Contacto realizado\n**ID conversacion**: `conv-test-t006`';

  console.log('1. Llamando createNote...');
  const note = await twentyService.createNote(title, body);
  console.log('   noteId:', note.id);
  console.log('   title:', note.title);

  // --- T006: createNoteTarget ---
  console.log('\n2. Buscando un Company para anclar la Note...');
  const companyId = await getFirstCompanyId();
  if (!companyId) {
    console.error('   No se encontro ningun Company en Twenty. Abortando.');
    process.exit(1);
  }
  console.log('   companyId:', companyId);

  console.log('\n3. Llamando createNoteTarget...');
  const noteTarget = await twentyService.createNoteTarget(note.id, { companyId });
  console.log('   noteTargetId:', noteTarget.id);
  console.log('   noteId:', noteTarget.noteId);
  console.log('   companyId:', noteTarget.companyId);

  console.log('\nVerifica en Twenty que la Note aparece en el timeline del establecimiento.');
  console.log('URL del Company: ' + process.env.TWENTY_BASE_URL?.replace('/api', '') + '/objects/companies/' + companyId);

  if (CLEANUP) {
    console.log('\n4. Limpiando...');
    await twentyService.client.delete(`/notes/${note.id}`);
    console.log('   Note eliminada (noteTarget eliminado en cascada).');
  }
}

run().catch((err) => {
  console.error('Error:', err.response?.data || err.message);
  process.exit(1);
});
