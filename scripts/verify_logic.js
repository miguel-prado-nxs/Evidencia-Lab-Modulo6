const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { buildCampaignContext } = require('./src/services/campaignContextService');

async function test() {
  try {
    console.log('--- START TEST ---');

    console.log('1. Finding or creating template...');
    const template = await prisma.couponTemplate.findFirst({
      where: { couponType: 'PLUS30' }
    });
    
    if (!template) {
       console.log('No PLUS30 template found, skipping real context test.');
       return;
    }

    console.log('2. Creating test campaign...');
    const campaign = await prisma.campaign.create({
      data: {
        name: 'TEST_' + Date.now(),
        type: 'ACQUISITION',
        status: 'DRAFT',
        couponPrefix: 'PLUS30',
        couponTemplateIds: [template.id]
      }
    });

    console.log(`[OK] Campaign created: ${campaign.id}`);

    // 2. Build Campaign Context
    console.log('3. Building campaign context...');
    const context = await buildCampaignContext(campaign.id, null);

    console.log('Context Output couponType:', context.coupons.couponType);
    console.log('Context Output Instructions included PLUS30:', context.agentInstructions.includes('PLUS30'));

    // 3. Verify specific fields
    const hasCouponType = context.coupons.couponType === 'PLUS30';
    const hasCorrectInstruction = context.agentInstructions.includes('PLUS30');

    console.log('--- VERIFICATION ---');
    console.log(`couponType in coupons: ${hasCouponType ? 'PASS' : 'FAIL'}`);
    console.log(`Correct instruction in agentInstructions: ${hasCorrectInstruction ? 'PASS' : 'FAIL'}`);

    // Cleanup
    await prisma.campaign.delete({ where: { id: campaign.id } });
    
    process.exit(hasCouponType && hasCorrectInstruction ? 0 : 1);
  } catch (err) {
    console.error('Test Execution Error:');
    console.error(err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

test();
