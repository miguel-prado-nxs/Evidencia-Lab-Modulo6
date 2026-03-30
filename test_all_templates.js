const axios = require('axios');

async function testAllTemplates() {
  const phone = '526672398415';
  
  // Vamos a probar todos los templates que encontramos en la base de datos
  const templates = ['TRIAL14', 'UPGRADEPRO', 'REFER', 'COMEBACK', 'PLUS30', '50OFF'];
  
  console.log('--- ENVIANDO TODOS LOS TEMPLATES A WHATSAPP ---');
  console.log('Target Phone:', phone);
  console.log('Templates a probar:', templates.join(', '));
  console.log('------------------------------------------------\n');
  
  for (const couponType of templates) {
    console.log(`Enviando template: ${couponType}...`);
    try {
      const res = await axios.post('http://localhost:3004/api/v1/coupons-whatsapp/generate-and-send', {
        phone,
        prospectName: 'Usuario de Prueba',
        businessName: 'Restaurante Test',
        agentId: 'test-agent',
        callId: 'test-all-' + couponType + '-' + Date.now(),
        couponType,
        scenario: 'test' // Ya sabemos que este campo es solo para analytics
      });
      
      const coupon = res.data?.data?.coupon;
      console.log(`  ✅ Éxito! Código generado: "${coupon?.code}"`);
      // Pequeña pausa para no saturar la API
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`  ❌ ERROR:`, err.response?.data || err.message);
    }
  }
  console.log('\n--- PRUEBA FINALIZADA ---');
  console.log('Revisa tu WhatsApp, deberías tener 6 mensajes diferentes.');
}

testAllTemplates();
