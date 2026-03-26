const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const testId = 'dfef657e-fa6b-4a19-87ec-f95b3fa9b96f';
  const variants = await prisma.abTestVariant.findMany({
    where: { abTestId: testId }
  });
  variants.forEach(variant => {
    console.log(`Variant: ${variant.name}`);
    console.log(`  Agent: ${variant.agentConfigId}`);
    console.log(`  Voice: ${variant.voiceId}`);
    console.log('---');
  });
}
main().finally(() => prisma.$disconnect());
