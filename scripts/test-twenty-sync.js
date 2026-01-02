/**
 * Script de prueba para sincronización Twenty
 * Simula el flujo de pipeline: ESTABLISHMENT -> CONTACT -> PROSPECT -> LEAD -> CLIENT
 */

const axios = require('axios');
require('dotenv').config();

const API_BASE_URL = 'http://localhost:3000/api/v1';
const ESTABLISHMENT_ID = '25006722511006041000000000U9'; // FANATICS RESTAURANT

async function testSync() {
  try {
    console.log('🧪 Testing Twenty Sync - FANATICS RESTAURANT\n');
    console.log(`EstablishmentId: ${ESTABLISHMENT_ID}\n`);

    // 1. ADD TO CONTACTS
    console.log('📞 PASO 1: Agregar a Contactos (ESTABLISHMENT → CONTACT)');
    const contactRes = await axios.post(
      `${API_BASE_URL}/geo/ventas/contacts`,
      { establishmentId: ESTABLISHMENT_ID },
      { headers: { 'Content-Type': 'application/json' } }
    );
    console.log('✓ Response:', contactRes.status, contactRes.data);

    // Esperar para que el worker procese
    console.log('\n⏳ Esperando 15s para que el worker procese...');
    await new Promise(resolve => setTimeout(resolve, 15000));

    // 2. CONVERT TO PROSPECT
    console.log('\n👔 PASO 2: Convertir a Prospecto (CONTACT → PROSPECT)');
    const prospectRes = await axios.post(
      `${API_BASE_URL}/geo/ventas/contacts/${ESTABLISHMENT_ID}/to-prospect`,
      {
        decisionMakerName: 'Roberto Lopez',
        decisionMakerPosition: 'Gerente General',
        decisionMakerPhone: '6671234567',
        decisionMakerEmail: 'roberto@fanaticsrestaurant.com'
      },
      { headers: { 'Content-Type': 'application/json' } }
    );
    console.log('✓ Response:', prospectRes.status, prospectRes.data);

    console.log('\n⏳ Esperando 15s para que el worker procese...');
    await new Promise(resolve => setTimeout(resolve, 15000));

    console.log('\n✅ Test completado! Verifica en Twenty CRM:');
    console.log('   1. Company actualizado con nivelPipeline=CONTACT → PROSPECT');
    console.log('   2. Contacto creado con phone/email');
    console.log('   3. Prospecto creado con datos del tomador');

  } catch (error) {
    console.error('\n❌ Error:', error.response?.data || error.message);
  }
}

testSync();
