/**
 * Script para verificar sesiones de WhatsApp en Baileys
 */

require('dotenv').config();

async function checkSessions() {
  console.log('🔍 Verificando sesiones de WhatsApp...\n');

  const BAILEYS_URL = process.env.BAILEYS_URL;
  const BAILEYS_API_KEY = process.env.BAILEYS_API_KEY;

  try {
    // Intentar obtener stats (no requiere HTML parsing)
    const statsResponse = await fetch(`${BAILEYS_URL}/api/stats`, {
      headers: {
        'X-API-KEY': BAILEYS_API_KEY
      }
    });

    if (statsResponse.ok) {
      const stats = await statsResponse.json();
      console.log('📊 Estadísticas del servicio:');
      console.log(JSON.stringify(stats, null, 2));
    }

    // Intentar obtener sesiones conectadas
    console.log('\n🔌 Intentando obtener sesiones conectadas...');
    const sessionsResponse = await fetch(`${BAILEYS_URL}/api/sessions/connected`, {
      headers: {
        'X-API-KEY': BAILEYS_API_KEY
      }
    });

    if (sessionsResponse.ok) {
      const sessions = await sessionsResponse.json();
      console.log('✅ Sesiones conectadas:');
      console.log(JSON.stringify(sessions, null, 2));

      if (sessions.sessions && sessions.sessions.length > 0) {
        const firstSession = sessions.sessions[0];
        console.log('\n💡 Usa este número como FROM:');
        console.log(`   BAILEYS_FROM_PHONE=${firstSession.phone || firstSession}`);
      } else {
        console.log('\n⚠️ No hay sesiones conectadas');
        console.log('   Necesitas conectar una sesión primero');
      }
    } else {
      console.log('⚠️ Endpoint /api/sessions/connected no disponible');
      console.log('   Status:', sessionsResponse.status);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }

  // Intentar enviar mensaje con un número hardcodeado común
  console.log('\n🧪 Probando con números comunes de sesión...');
  
  const commonNumbers = [
    '5213334031916',
    '5216672398415',
    '523891234567'
  ];

  for (const fromNumber of commonNumbers) {
    console.log(`\n   Probando desde: ${fromNumber}`);
    
    try {
      const testResponse = await fetch(`${BAILEYS_URL}/api/messages/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': BAILEYS_API_KEY
        },
        body: JSON.stringify({
          from: fromNumber,
          to: '526672398415',
          message: '🧪 Test de conexión',
          mediaUrl: 'https://picsum.photos/800/600',
          mediaType: 'image'
        })
      });

      const result = await testResponse.json();
      
      if (testResponse.ok) {
        console.log(`   ✅ FUNCIONA con ${fromNumber}`);
        console.log(`   📝 Agrega a .env: BAILEYS_FROM_PHONE=${fromNumber}`);
        console.log(`   📱 Revisa WhatsApp para confirmar`);
        break;
      } else {
        console.log(`   ❌ Error: ${result.error || result.message}`);
      }
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }
}

checkSessions();
