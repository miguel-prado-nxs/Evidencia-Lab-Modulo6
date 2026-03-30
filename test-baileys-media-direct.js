/**
 * Test directo del endpoint de Baileys para verificar si procesa mediaUrl
 */

require('dotenv').config();

async function testMediaDirect() {
  const BAILEYS_URL = process.env.BAILEYS_URL;
  const BAILEYS_API_KEY = process.env.BAILEYS_API_KEY;

  console.log('🧪 Test directo de media en Baileys\n');

  // Test 1: Mensaje CON imagen
  console.log('1️⃣ Enviando mensaje CON imagen...');
  const payloadWithImage = {
    from: '523891087325',
    to: '526672398415',
    message: '🖼️ TEST 1: Este mensaje DEBE tener imagen',
    mediaUrl: 'https://picsum.photos/800/600',
    mediaType: 'image'
  };

  console.log('Payload:', JSON.stringify(payloadWithImage, null, 2));

  try {
    const response1 = await fetch(`${BAILEYS_URL}/api/messages/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': BAILEYS_API_KEY
      },
      body: JSON.stringify(payloadWithImage)
    });

    const result1 = await response1.json();
    console.log('Respuesta:', JSON.stringify(result1, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
  }

  // Esperar 3 segundos
  console.log('\n⏳ Esperando 3 segundos...\n');
  await new Promise(r => setTimeout(r, 3000));

  // Test 2: Mensaje SIN imagen (control)
  console.log('2️⃣ Enviando mensaje SIN imagen (control)...');
  const payloadNoImage = {
    from: '523891087325',
    to: '526672398415',
    message: '📝 TEST 2: Este mensaje NO debe tener imagen'
  };

  console.log('Payload:', JSON.stringify(payloadNoImage, null, 2));

  try {
    const response2 = await fetch(`${BAILEYS_URL}/api/messages/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': BAILEYS_API_KEY
      },
      body: JSON.stringify(payloadNoImage)
    });

    const result2 = await response2.json();
    console.log('Respuesta:', JSON.stringify(result2, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
  }

  console.log('\n📱 Revisa WhatsApp en 6672398415');
  console.log('   Deberías ver:');
  console.log('   1. Mensaje "TEST 1" CON imagen 🖼️');
  console.log('   2. Mensaje "TEST 2" SIN imagen 📝');
  console.log('\n❓ Si ambos llegaron sin imagen, el servicio Baileys necesita reiniciarse');
}

testMediaDirect();
