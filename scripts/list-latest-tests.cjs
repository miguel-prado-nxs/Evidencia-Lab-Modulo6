const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const tests = await prisma.abTest.findMany({
    orderBy: { createdAt: 'desc' },
    take: 3,
    include: {
      variants: {
        include: {
          _count: { select: { contacts: true } }
        }
      }
    }
  });
  console.log(JSON.stringify(tests, null, 2));
}
main().finally(() => prisma.$disconnect());
