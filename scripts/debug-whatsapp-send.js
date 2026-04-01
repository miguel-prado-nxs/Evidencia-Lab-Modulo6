/**
 * Script para debuggear el envío de WhatsApp con imagen
 */

require('dotenv').config();

async function debugWhatsAppSend() {
  console.log('🔍 Debuggeando envío de WhatsApp con imagen...\n');

  const BAILEYS_URL = process.env.BAILEYS_URL;
  const BAILEYS_API_KEY = process.env.BAILEYS_API_KEY;
  const BAILEYS_FROM_PHONE = process.env.BAILEYS_FROM_PHONE;

  console.log('📋 Configuración:');
  console.log('   BAILEYS_URL:', BAILEYS_URL);
  console.log('   BAILEYS_API_KEY:', BAILEYS_API_KEY ? '✅ Configurada' : '❌ No configurada');
  console.log('   BAILEYS_FROM_PHONE:', BAILEYS_FROM_PHONE || '❌ No configurado (usará sesión activa)');

  // 1. Verificar sesiones activas
  console.log('\n1️⃣ Verificando sesiones activas...');
  try {
    const sessionsResponse = await fetch(`${BAILEYS_URL}/api/sessions/status`, {
      headers: {
        'X-API-KEY': BAILEYS_API_KEY
      }
    });
    const sessions = await sessionsResponse.json();
    console.log('✅ Sesiones:', JSON.stringify(sessions, null, 2));

    const connectedSessions = Object.entries(sessions).filter(([_, s]) => s.status === 'connected');
    console.log(`\n📊 Sesiones conectadas: ${connectedSessions.length}`);
    connectedSessions.forEach(([phone, session]) => {
      console.log(`   ✅ ${phone}: ${session.status}`);
    });

    if (connectedSessions.length === 0) {
      console.log('\n❌ NO HAY SESIONES CONECTADAS');
      console.log('   Necesitas conectar una sesión de WhatsApp primero');
      return;
    }

  } catch (error) {
    console.error('❌ Error obteniendo sesiones:', error.message);
  }

  // 2. Enviar mensaje de prueba CON imagen
  console.log('\n2️⃣ Enviando mensaje de prueba CON imagen...');
  
  const testPayload = {
    to: '526672398415',
    message: '🧪 PRUEBA DE IMAGEN\n\nEste es un mensaje de prueba con imagen de Picsum.',
    mediaUrl: 'https://picsum.photos/800/600',
    mediaType: 'image',
    from: BAILEYS_FROM_PHONE || undefined
  };

  console.log('📦 Payload:');
  console.log(JSON.stringify(testPayload, null, 2));

  try {
    const response = await fetch(`${BAILEYS_URL}/api/messages/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': BAILEYS_API_KEY
      },
      body: JSON.stringify(testPayload)
    });

    const result = await response.json();
    
    console.log('\n📨 Respuesta de Baileys:');
    console.log('Status:', response.status, response.statusText);
    console.log('Body:', JSON.stringify(result, null, 2));

    if (response.ok) {
      console.log('\n✅ Mensaje enviado a Baileys');
      console.log('📱 Revisa WhatsApp en 526672398415');
      console.log('🖼️ Deberías ver una imagen de Picsum');
    } else {
      console.log('\n❌ Error al enviar mensaje');
      console.log('   Detalles:', result.error || result.message);
    }

  } catch (error) {
    console.error('\n❌ Error enviando mensaje:', error.message);
  }

  // 3. Enviar mensaje SIN imagen (control)
  console.log('\n3️⃣ Enviando mensaje de prueba SIN imagen (control)...');
  
  const testPayloadNoImage = {
    to: '526672398415',
    message: '📝 PRUEBA SIN IMAGEN\n\nEste es un mensaje de prueba sin imagen.',
    from: BAILEYS_FROM_PHONE || undefined
  };

  try {
    const response = await fetch(`${BAILEYS_URL}/api/messages/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': BAILEYS_API_KEY
      },
      body: JSON.stringify(testPayloadNoImage)
    });

    const result = await response.json();
    
    console.log('\n📨 Respuesta de Baileys (sin imagen):');
    console.log('Status:', response.status, response.statusText);

    if (response.ok) {
      console.log('✅ Mensaje sin imagen enviado');
    } else {
      console.log('❌ Error:', result.error || result.message);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }

  console.log('\n✅ Debug completado');
}

debugWhatsAppSend();
