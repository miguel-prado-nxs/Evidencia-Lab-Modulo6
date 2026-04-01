const axios = require('axios');

async function testCleanCoupons() {
  const phone = '526672398415';
  const couponType = 'PLUS30'; 
  const scenarios = ['closing', 'price_objection', 'interest_high', 'follow_up'];
  
  console.log('--- WhatsApp Clean Coupon Test ---');
  console.log('Target:', phone);
  console.log('Expected code in message: PLUS30 (limpio, sin sufijos)\n');
  
  for (const scenario of scenarios) {
    console.log(`Scenario: ${scenario}...`);
    try {
      const res = await axios.post('http://localhost:3004/api/v1/coupons-whatsapp/generate-and-send', {
        phone,
        prospectName: 'Test User',
        businessName: 'Restaurante ' + scenario,
        agentId: 'test-agent',
        callId: 'test-clean-' + scenario + '-' + Date.now(),
        couponType,
        scenario
      });
      
      const coupon = res.data?.data?.coupon;
      console.log(`  [OK] DB code: "${coupon?.code}" | couponType: "${coupon?.couponType}"`);
    } catch (err) {
      console.error(`  [ERROR]`, err.response?.data || err.message);
    }
  }
  console.log('\n--- DONE ---');
}

testCleanCoupons();
