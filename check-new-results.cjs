const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const c1 = await prisma.abTestContact.findUnique({where:{id:'ef10f365-9035-4c89-9c51-32d1dacadfa3'}});
  console.log('Result 1:', c1 ? c1.result : 'NOT FOUND');
  const c2 = await prisma.abTestContact.findUnique({where:{id:'fbbc1674-cc8c-4635-a854-159bed926c30'}});
  console.log('Result 2:', c2 ? c2.result : 'NOT FOUND');
}
main().finally(()=>prisma.$disconnect());
