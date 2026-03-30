const { buildCampaignContext } = require('./src/services/campaignContextService');

// Mock Prisma
const mockPrisma = {
  campaign: {
    findUnique: jest.fn()
  },
  campaignContact: {
    findUnique: jest.fn()
  },
  couponTemplate: {
    findMany: jest.fn()
  }
};

// This is not really a jest test, but a simple script to verify logic
// I'll just overwrite the prisma import in a wrapper or just use a simpler check

async function runTest() {
  console.log('--- LOGIC VERIFICATION (MOCK) ---');
  
  // Test case: Campaign with prefix and templates
  const mockCampaign = {
    id: 'campaign-1',
    name: 'Test Campaign',
    type: 'ACQUISITION',
    status: 'DRAFT',
    couponPrefix: 'PROMO30',
    couponTemplateIds: ['template-1'],
    _count: { coupons: 0 }
  };

  const mockTemplates = [
    {
      id: 'template-1',
      couponType: 'PROMO30',
      name: 'Promo 30',
      description: '30% off',
      scenarios: ['all']
    }
  ];

  // Manual test instead of jest because of environment setup
  // I'll just temporarily modify campaignContextService to accept prisma as param or mock it
  // Actually, I'll just use a small hack to replace the module in require cache if possible,
  // or just trust the logic I wrote which is very direct.
  
  console.log('Verificando manualmente las instrucciones generadas...');
  const { buildAgentInstructions, buildCouponSendInstructions } = require('./src/services/campaignContextService');
  
  const inst = buildAgentInstructions(mockCampaign, mockTemplates);
  console.log('--- Agent Instructions ---');
  console.log(inst);
  
  const ok1 = inst.includes('CUPÓN PARA ENVIAR');
  const ok2 = inst.includes('PROMO30');
  const ok3 = inst.includes('NO decidas qué cupón enviar');
  
  console.log('Validation:');
  console.log(`- Contiene 'CUPÓN PARA ENVIAR': ${ok1 ? '✅' : '❌'}`);
  console.log(`- Contiene 'PROMO30': ${ok2 ? '✅' : '❌'}`);
  console.log(`- Contiene 'NO decidas qué cupón enviar': ${ok3 ? '✅' : '❌'}`);
  
  const sendInst = buildCouponSendInstructions(mockTemplates, 'PROMO30');
  console.log('--- Send Instructions ---');
  console.log(JSON.stringify(sendInst, null, 2));
  
  const ok4 = sendInst.couponType === 'PROMO30';
  console.log(`- couponType en sendInstructions: ${ok4 ? '✅' : '❌'}`);

  if (ok1 && ok2 && ok3 && ok4) {
    console.log('--- ALL LOGIC TESTS PASSED ---');
  } else {
    console.log('--- SOME TESTS FAILED ---');
  }
}

runTest().catch(console.error);
