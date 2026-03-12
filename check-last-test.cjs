const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const tests = await prisma.abTest.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: { variants: true }
  });

  tests.forEach(t => {
    console.log(`Test: ${t.name} (${t.agentType})`);
    t.variants.forEach(v => {
      console.log(`  - Variant ${v.agentConfigName}: voiceId="${v.voiceId}"`);
    });
  });
  process.exit(0);
}

check();
