const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const c1 = await prisma.abTestContact.findUnique({where:{id:'0c205746-4d11-407d-95e3-922a8352a07d'}, include:{variant:true}});
  console.log('Contact 1 Voice:', c1?.variant?.voiceId, 'Variant:', c1?.variant?.name);
  const c2 = await prisma.abTestContact.findUnique({where:{id:'68a2d33c-fb16-42d9-a8c2-4ff383c339f1'}, include:{variant:true}});
  console.log('Contact 2 Voice:', c2?.variant?.voiceId, 'Variant:', c2?.variant?.name);
}
main().finally(()=>prisma.$disconnect());
