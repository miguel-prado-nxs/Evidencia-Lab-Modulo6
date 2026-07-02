/**
 * Spike verification script: Twenty CRM Notes API
 *
 * Purpose: Verify that the deployed Twenty instance supports Note creation via REST API
 * and determine whether the body field accepts markdown (legacy `body`) or structured JSON (bodyV2).
 *
 * Usage:
 *   TWENTY_BASE_URL=https://api.crm.development.easyorder.mx \
 *   TWENTY_API_KEY=your-key-here \
 *   node prisma/scripts/verify-twenty-notes.js [--cleanup]
 *
 * Pass --cleanup to delete the test note after verification.
 */

require('dotenv').config();
const axios = require('axios');

const BASE_URL = process.env.TWENTY_BASE_URL || 'https://api.crm.development.easyorder.mx';
const API_KEY = process.env.TWENTY_API_KEY;
const CLEANUP = process.argv.includes('--cleanup');

if (!API_KEY) {
  console.error('Error: TWENTY_API_KEY is required. Set it in .env or pass inline.');
  process.exit(1);
}

const client = axios.create({
  baseURL: `${BASE_URL}/rest`,
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

async function run() {
  console.log(`\n=== Twenty Notes API Verification ===`);
  console.log(`Instance: ${BASE_URL}`);
  console.log(`Cleanup mode: ${CLEANUP}\n`);

  // 1. Test POST /notes with legacy body field (markdown string)
  console.log('--- Test 1: POST /notes with markdown body (legacy field) ---');
  let markdownNoteId = null;
  try {
    const payload = {
      title: '[SPIKE-TEST] Markdown body test',
      body: '**Campaña**: Test\n**Etapa**: Discovery\n**Resultado**: Sin respuesta',
    };
    const res = await client.post('/notes', payload);
    const created = res.data.data?.createNote || res.data;
    markdownNoteId = created?.id;
    console.log('PASS: POST /notes with body (markdown string) - noteId:', markdownNoteId);
    console.log('Response fields:', Object.keys(created || {}).join(', '));
  } catch (err) {
    console.log('FAIL: body (markdown) not accepted -', err.response?.data?.messages || err.message);
  }

  // 2. Test POST /notes with bodyV2: { markdown: string } — formato correcto confirmado por error del Test 1
  console.log('\n--- Test 2: POST /notes with bodyV2: { markdown: string } ---');
  let bodyV2NoteId = null;
  try {
    const payload = {
      title: '[SPIKE-TEST] BodyV2 markdown test',
      bodyV2: {
        markdown: '**Campaña**: Test\n**Etapa**: Discovery\n**Resultado**: Sin respuesta\n**ID conversacion**: `conv-test-123`',
      },
    };
    const res = await client.post('/notes', payload);
    const created = res.data.data?.createNote || res.data;
    bodyV2NoteId = created?.id;
    console.log('PASS: POST /notes with bodyV2.markdown - noteId:', bodyV2NoteId);
    console.log('Response fields:', Object.keys(created || {}).join(', '));
    console.log('bodyV2 value in response:', JSON.stringify(created?.bodyV2));
  } catch (err) {
    console.log('FAIL: bodyV2.markdown not accepted -', err.response?.data?.messages || err.message);
  }

  // 3. Test POST /noteTargets if we have a note
  const testNoteId = markdownNoteId || bodyV2NoteId;
  console.log('\n--- Test 3: POST /noteTargets ---');
  if (!testNoteId) {
    console.log('SKIP: No note created in previous tests');
  } else {
    // Find a company to use as target
    let companyId = null;
    try {
      const compRes = await client.get('/companies', { params: { limit: 1 } });
      const companies = compRes.data.data?.companies || compRes.data.data || [];
      companyId = companies[0]?.id;
    } catch (err) {
      console.log('Could not find a company for testing:', err.message);
    }

    if (companyId) {
      try {
        const res = await client.post('/noteTargets', {
          noteId: testNoteId,
          companyId,
        });
        const created = res.data.data?.createNoteTarget || res.data;
        console.log('PASS: POST /noteTargets - noteTargetId:', created?.id);
        console.log('Response fields:', Object.keys(created || {}).join(', '));
      } catch (err) {
        console.log('FAIL: POST /noteTargets -', err.response?.data?.messages || err.message);
      }
    } else {
      console.log('SKIP: No company found to anchor the note');
    }
  }

  // 4. Cleanup test notes
  if (CLEANUP) {
    console.log('\n--- Cleanup ---');
    for (const id of [markdownNoteId, bodyV2NoteId].filter(Boolean)) {
      try {
        await client.delete(`/notes/${id}`);
        console.log('Deleted test note:', id);
      } catch (err) {
        console.log('Could not delete note', id, '-', err.message);
      }
    }
  }

  console.log('\n=== Summary ===');
  console.log('Markdown body (legacy):', markdownNoteId ? 'SUPPORTED' : 'NOT SUPPORTED');
  console.log('BodyV2 (blocknote JSON):', bodyV2NoteId ? 'SUPPORTED' : 'NOT SUPPORTED');
  console.log('\nDocument results in specs/001-crm-mejoras-marketing/research.md (section "Formato del body")');
}

run().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
