const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const c = await prisma.abTestContact.findUnique({where:{id:'0c205746-4d11-407d-95e3-922a8352a07d'}});
  console.log('Result:', c ? c.result : 'NOT FOUND');
}
main().finally(()=>prisma.$disconnect());
