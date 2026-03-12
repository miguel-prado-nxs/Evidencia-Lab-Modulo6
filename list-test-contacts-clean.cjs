const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const testId = 'dfef657e-fa6b-4a19-87ec-f95b3fa9b96f';
  const contacts = await prisma.abTestContact.findMany({
    where: { variant: { abTestId: testId } },
    include: { variant: true }
  });
  contacts.forEach(c => {
    console.log(`Contact: ${c.id}`);
    console.log(`  Variant: ${c.variant.name} (${c.variant.id})`);
    console.log(`  Voice: ${c.variant.voiceId}`);
    console.log(`  Result: ${c.result}`);
    console.log('---');
  });
}
main().finally(() => prisma.$disconnect());
