const { buildAgentInstructions, buildCouponSendInstructions } = require('./src/services/campaignContextService');

async function test() {
  console.log('--- LOGIC VERIFICATION (MOCK) ---');
  
  const mockCampaign = {
    id: 'campaign-1',
    name: 'Test Campaign',
    type: 'ACQUISITION',
    status: 'DRAFT',
    couponPrefix: 'PROMO30',
    description: 'Test description',
    offer: 'Test offer'
  };

  const mockTemplates = [
    {
      id: 'template-1',
      couponType: 'PROMO30',
      name: 'Promo 30',
      description: '30% off',
      scenarios: ['all'],
      percentOff: 30,
      durationMonths: 1,
      trialDays: 30
    }
  ];

  console.log('1. Verificando buildAgentInstructions...');
  const agentInst = buildAgentInstructions(mockCampaign, mockTemplates);
  
  const ok1 = agentInst.includes('CUPÓN PARA ENVIAR');
  const ok2 = agentInst.includes('PROMO30');
  const ok3 = agentInst.includes('NO decidas qué cupón enviar');
  const ok4 = !agentInst.includes('Especifica qué tipo de cupón es más apropiado'); // Logic was removed

  console.log(`- Contiene 'CUPÓN PARA ENVIAR': ${ok1 ? '✅' : '❌'}`);
  console.log(`- Contiene 'PROMO30': ${ok2 ? '✅' : '❌'}`);
  console.log(`- Contiene 'NO decidas qué cupón enviar': ${ok3 ? '✅' : '❌'}`);
  console.log(`- NO contiene orden de decidir: ${ok4 ? '✅' : '❌'}`);

  console.log('2. Verificando buildCouponSendInstructions...');
  const sendInst = buildCouponSendInstructions(mockTemplates, 'PROMO30');
  
  const ok5 = sendInst.couponType === 'PROMO30';
  const ok6 = sendInst.enabled === true;
  const ok7 = sendInst.templates[0].instruction === 'Enviar cupón PROMO30 (Promo 30) si el prospecto está interesado';

  console.log(`- couponType es PROMO30: ${ok5 ? '✅' : '❌'}`);
  console.log(`- Instrucción de envío es directa: ${ok7 ? '✅' : '❌'}`);

  if (ok1 && ok2 && ok3 && ok4 && ok5 && ok6 && ok7) {
    console.log('\n--- ALL LOGIC TESTS PASSED ---');
    process.exit(0);
  } else {
    console.log('\n--- SOME TESTS FAILED ---');
    process.exit(1);
  }
}

test().catch(err => {
  console.error(err);
  process.exit(1);
});
