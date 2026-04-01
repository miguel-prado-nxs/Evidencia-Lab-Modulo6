/**
 * Script para encontrar la sesión activa de WhatsApp
 */

require('dotenv').config();

async function findActiveSession() {
  console.log('🔍 Buscando sesión activa de WhatsApp...\n');

  const BAILEYS_URL = process.env.BAILEYS_URL;
  const BAILEYS_API_KEY = process.env.BAILEYS_API_KEY;

  // Probar diferentes variaciones de números conocidos
  const phoneVariations = [
    // Sin código de país
    '3334031916',
    '6672398415',
    '3891234567',
    // Con 52
    '523334031916',
    '526672398415',
    '523891234567',
    // Con 521
    '5213334031916',
    '5216672398415',
    '5213891234567',
  ];

  console.log('🧪 Probando diferentes variaciones de números...\n');

  for (const phone of phoneVariations) {
    try {
      const response = await fetch(`${BAILEYS_URL}/api/messages/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': BAILEYS_API_KEY
        },
        body: JSON.stringify({
          from: phone,
          to: '526672398415',
          message: '🧪 Test automático - encontrando sesión activa',
          mediaUrl: 'https://picsum.photos/800/600',
          mediaType: 'image'
        })
      });

      const result = await response.json();
      
      if (response.ok) {
        console.log(`\n✅✅✅ ¡ENCONTRADA! Sesión activa: ${phone}`);
        console.log(`\n📝 Agrega esto a tu .env:`);
        console.log(`BAILEYS_FROM_PHONE=${phone}`);
        console.log(`\n📱 Revisa WhatsApp en 6672398415`);
        console.log(`🖼️ Deberías ver el mensaje con imagen`);
        console.log(`\n📨 Respuesta completa:`);
        console.log(JSON.stringify(result, null, 2));
        return phone;
      } else {
        const errorMsg = result.error || result.message || '';
        if (errorMsg.includes('No active session')) {
          console.log(`   ❌ ${phone}: No tiene sesión activa`);
        } else if (errorMsg.includes('not connected')) {
          console.log(`   ⚠️ ${phone}: Sesión existe pero no conectada`);
        } else {
          console.log(`   ❌ ${phone}: ${errorMsg}`);
        }
      }
    } catch (error) {
      console.log(`   ❌ ${phone}: Error de conexión`);
    }
  }

  console.log('\n❌ No se encontró ninguna sesión activa');
  console.log('\n💡 Opciones:');
  console.log('   1. Conecta una sesión de WhatsApp en el dashboard de Baileys');
  console.log('   2. Visita: https://whatsapp-baileys.okcrm.mx');
  console.log('   3. Genera un código de emparejamiento para un número');
}

findActiveSession();
