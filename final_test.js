const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { buildCampaignContext } = require('./src/services/campaignContextService');

async function test() {
  try {
    console.log('--- START TEST ---');

    console.log('0. Finding a partner...');
    const partner = await prisma.partner.findFirst();
    if (!partner) throw new Error('No partner found in DB');

    console.log('1. Upserting template...');
    const template = await prisma.couponTemplate.upsert({
      where: { couponType: 'TEST_V2' },
      update: { active: true },
      create: {
        name: 'Test Template V2',
        couponType: 'TEST_V2',
        description: 'Template for logic verification',
        percentOff: 20,
        active: true,
        scenarios: ['test'],
        validFor: 'SUBSCRIPTION',
        maxPerUser: 1,
        expiresHours: 24
      }
    });

    console.log('2. Creating test campaign...');
    const campaign = await prisma.campaign.create({
      data: {
        name: 'TEST_CONTEXT_V2_' + Date.now(),
        type: 'ACQUISITION',
        status: 'DRAFT',
        partnerId: partner.id,
        couponPrefix: 'TEST_V2',
        couponTemplateIds: [template.id]
      }
    });

    console.log(`[OK] Campaign created: ${campaign.id}`);

    // 2. Build Campaign Context
    console.log('3. Building campaign context...');
    const context = await buildCampaignContext(campaign.id, null);

    console.log('--- Context Verification ---');
    const couponTypeMatch = context.coupons.couponType === 'TEST_V2';
    const instructionsMatch = context.agentInstructions.includes('TEST_V2');
    const directOrderMatch = context.agentInstructions.includes('NO decidas qué cupón enviar');

    console.log(`couponType match: ${couponTypeMatch ? '✅' : '❌'}`);
    console.log(`Instructions include TEST_V2: ${instructionsMatch ? '✅' : '❌'}`);
    console.log(`Direct order (no decision): ${directOrderMatch ? '✅' : '❌'}`);

    // Cleanup
    await prisma.campaign.delete({ where: { id: campaign.id } });
    await prisma.couponTemplate.delete({ where: { id: template.id } });
    
    if (couponTypeMatch && instructionsMatch && directOrderMatch) {
      console.log('--- TEST PASSED ---');
      process.exit(0);
    } else {
      console.log('--- TEST FAILED ---');
      process.exit(1);
    }
  } catch (err) {
    console.error('Test Execution Error:');
    console.error(err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

test();
