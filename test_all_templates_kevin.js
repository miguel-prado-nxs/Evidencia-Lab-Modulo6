const axios = require('axios');

async function testAllTemplatesKevin() {
  const phone = '526672078063'; // Kevin Gomez
  
  // Vamos a probar todos los templates que encontramos en la base de datos
  const templates = ['TRIAL14', 'UPGRADEPRO', 'REFER', 'COMEBACK', 'PLUS30', '50OFF'];
  
  console.log('--- ENVIANDO TODOS LOS TEMPLATES A KEVIN GOMEZ ---');
  console.log('Target Phone:', phone);
  console.log('Templates a probar:', templates.join(', '));
  console.log('------------------------------------------------\n');
  
  for (const couponType of templates) {
    console.log(`Enviando template: ${couponType}...`);
    try {
      const res = await axios.post('http://localhost:3004/api/v1/coupons-whatsapp/generate-and-send', {
        phone,
        prospectName: 'Kevin Gomez',
        businessName: 'Restaurante Kevin',
        agentId: 'test-agent',
        callId: 'test-kevin-' + couponType + '-' + Date.now(),
        couponType,
        scenario: 'test' // Analytics
      });
      
      const coupon = res.data?.data?.coupon;
      console.log(`  ✅ Éxito! Código generado: "${coupon?.code}"`);
      // Pequeña pausa para no saturar la API ni a Baileys
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`  ❌ ERROR:`, err.response?.data || err.message);
    }
  }
  console.log('\n--- PRUEBA FINALIZADA PARA KEVIN ---');
}

testAllTemplatesKevin();
