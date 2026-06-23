/**
 * Test manual de createNote en twentyService
 * Uso: node prisma/scripts/test-create-note.js [--cleanup]
 */
require('dotenv').config();
const twentyService = require('../../src/services/twenty/twentyService');

const CLEANUP = process.argv.includes('--cleanup');

async function run() {
  const title = '[TEST] createNote — ' + new Date().toLocaleString('es-MX');
  const body = '**Campaña**: Test manual T005\n**Etapa**: Discovery\n**Resultado**: Contacto realizado\n**ID conversacion**: `conv-test-t005`';

  console.log('Llamando createNote...');
  const note = await twentyService.createNote(title, body);

  console.log('noteId:', note.id);
  console.log('title:', note.title);
  console.log('bodyV2:', JSON.stringify(note.bodyV2));

  if (CLEANUP) {
    await twentyService.client.delete(`/notes/${note.id}`);
    console.log('Note eliminada.');
  }
}

run().catch((err) => {
  console.error('Error:', err.response?.data || err.message);
  process.exit(1);
});
