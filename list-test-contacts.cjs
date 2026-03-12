const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const testId = 'dfef657e-fa6b-4a19-87ec-f95b3fa9b96f';
  const contacts = await prisma.abTestContact.findMany({
    where: { variant: { abTestId: testId } },
    include: { variant: true }
  });
  console.log(JSON.stringify(contacts, null, 2));
}
main().finally(() => prisma.$disconnect());
