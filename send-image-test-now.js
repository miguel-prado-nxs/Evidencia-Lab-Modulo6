/**
 * Enviar mensaje con imagen usando sesión activa
 */

require('dotenv').config();

async function sendImageNow() {
  const BAILEYS_URL = process.env.BAILEYS_URL;
  const BAILEYS_API_KEY = process.env.BAILEYS_API_KEY;

  console.log('📤 Enviando mensaje con imagen...\n');

  const payload = {
    from: '523891087325', // Sesión activa
    to: '526672398415',
    message: '🎉 PRUEBA DE IMAGEN CON CUPÓN\n\nHola! Este es un mensaje de prueba con imagen de Picsum.\n\n✅ Si ves esta imagen, la implementación funciona correctamente.',
    mediaUrl: 'https://picsum.photos/800/600',
    mediaType: 'image'
  };

  console.log('📦 Payload:');
  console.log(JSON.stringify(payload, null, 2));

  try {
    const response = await fetch(`${BAILEYS_URL}/api/messages/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': BAILEYS_API_KEY
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    console.log('\n📨 Respuesta:');
    console.log('Status:', response.status);
    console.log(JSON.stringify(result, null, 2));

    if (response.ok) {
      console.log('\n✅ Mensaje enviado exitosamente!');
      console.log('📱 Revisa WhatsApp en 6672398415');
      console.log('🖼️ Deberías ver la imagen de Picsum');
    } else {
      console.log('\n❌ Error al enviar');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

sendImageNow();
