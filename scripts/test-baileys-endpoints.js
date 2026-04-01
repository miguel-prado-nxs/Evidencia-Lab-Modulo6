/**
 * Script para probar diferentes endpoints de Baileys
 */

require('dotenv').config();

async function testBaileysEndpoints() {
  const BAILEYS_URL = process.env.BAILEYS_URL;
  const BAILEYS_API_KEY = process.env.BAILEYS_API_KEY;

  console.log('🔍 Probando endpoints de Baileys...\n');

  const endpoints = [
    '/api/sessions',
    '/api/sessions/status',
    '/api/sessions/connected',
    '/api/stats',
    '/api/sessions/list'
  ];

  for (const endpoint of endpoints) {
    console.log(`\n📡 Probando: ${BAILEYS_URL}${endpoint}`);
    try {
      const response = await fetch(`${BAILEYS_URL}${endpoint}`, {
        headers: {
          'X-API-KEY': BAILEYS_API_KEY
        }
      });

      const contentType = response.headers.get('content-type');
      console.log(`   Status: ${response.status}`);
      console.log(`   Content-Type: ${contentType}`);

      if (contentType?.includes('application/json')) {
        const data = await response.json();
        console.log(`   ✅ JSON Response:`);
        console.log(JSON.stringify(data, null, 2));
      } else {
        const text = await response.text();
        console.log(`   ⚠️ HTML Response (primeros 200 chars):`);
        console.log(text.substring(0, 200));
      }
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }
}

testBaileysEndpoints();
