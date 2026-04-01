/**
 * Script para enviar cupón de prueba con imagen
 */

require('dotenv').config();

async function sendTestCoupon() {
  console.log('📤 Enviando cupón de prueba con imagen...\n');

  const API_URL = process.env.API_URL || `http://localhost:${process.env.PORT || 3004}`;
  const API_KEY = process.env.BAILEYS_API_KEY || process.env.API_KEY_SECRET;

  if (!API_KEY) {
    console.error('❌ Error: API_KEY no configurada en .env');
    console.log('   Agrega: BAILEYS_API_KEY=tu_api_key en el archivo .env');
    process.exit(1);
  }

  const payload = {
    phone: "526674509486", // Número de prueba
    prospectName: "Test Usuario",
    businessName: "Restaurante Test",
    couponType: "PLUS30",
    scenario: "interested",
    agentId: "test_agent",
    callId: "test_call_" + Date.now()
  };

  console.log('📋 Datos del cupón:');
  console.log(JSON.stringify(payload, null, 2));
  console.log('\n🔗 Endpoint:', `${API_URL}/api/v1/coupons-whatsapp/generate-and-send`);
  console.log('🔑 API Key:', API_KEY.substring(0, 10) + '...');

  try {
    const response = await fetch(`${API_URL}/api/v1/coupons-whatsapp/generate-and-send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': API_KEY
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    console.log('\n📨 Respuesta del servidor:');
    console.log('Status:', response.status, response.statusText);
    console.log('Body:', JSON.stringify(data, null, 2));

    if (response.ok) {
      console.log('\n✅ Cupón enviado exitosamente!');
      console.log('📱 Revisa WhatsApp en el número:', payload.phone);
      console.log('🖼️ El mensaje debe incluir una imagen de Picsum');
      
      if (data.coupon) {
        console.log('\n📋 Detalles del cupón:');
        console.log('   Código:', data.coupon.code);
        console.log('   Tipo:', data.coupon.couponType);
        console.log('   Beneficio:', data.coupon.offer);
      }

      if (data.whatsappSent) {
        console.log('\n✅ WhatsApp enviado correctamente');
      } else {
        console.log('\n⚠️ Cupón generado pero WhatsApp no enviado');
        console.log('   Razón:', data.whatsappError || 'Desconocida');
      }
    } else {
      console.log('\n❌ Error al enviar cupón');
      console.log('   Mensaje:', data.error || data.message);
    }

  } catch (error) {
    console.error('\n❌ Error de conexión:', error.message);
    console.log('\n💡 Verifica que:');
    console.log('   1. El servidor esté corriendo (npm run dev)');
    console.log('   2. El puerto sea el correcto (3000)');
    console.log('   3. El servicio Baileys esté activo');
  }
}

sendTestCoupon();
