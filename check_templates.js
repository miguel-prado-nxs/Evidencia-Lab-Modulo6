const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkTemplates() {
  const templates = await prisma.couponTemplate.findMany({
    where: { active: true }
  });

  console.log(`Encontrados ${templates.length} templates activos:\n`);
  
  for (const t of templates) {
    console.log(`========================================================`);
    console.log(`🎟 couponType: ${t.couponType}`);
    console.log(`📝 Nombre: ${t.name}`);
    console.log(`🔄 Scenarios: ${t.scenarios.join(', ')}`);
    console.log(`\n📄 TEMPLATE TEXT:\n${t.messageTemplate}`);
    console.log(`========================================================\n`);
  }

  await prisma.$disconnect();
}

checkTemplates().catch(console.error);
