const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkLastTest() {
  try {
    const lastTest = await prisma.abTest.findFirst({
      orderBy: { createdAt: 'desc' },
      include: {
        variants: true
      }
    });

    if (!lastTest) {
      console.log('No tests found');
      return;
    }

    console.log(`Test: ${lastTest.name} (${lastTest.id})`);
    lastTest.variants.forEach((v, i) => {
      console.log(`Variant ${i + 1}: ID=${v.id}, VoiceID=${v.voiceId}`);
    });

  } catch (error) {
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

checkLastTest();
