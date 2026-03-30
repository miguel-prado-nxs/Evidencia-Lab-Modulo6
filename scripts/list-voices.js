const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const personalities = await prisma.elevenLabsPersonality.findMany({
    orderBy: { name: 'asc' }
  });
  console.log('Voices in DB:', personalities.length);
  personalities.forEach(p => {
    console.log(`- ${p.name} (${p.voiceId}) | Active: ${p.isActive}`);
  });
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
