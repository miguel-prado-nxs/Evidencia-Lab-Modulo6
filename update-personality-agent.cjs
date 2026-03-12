const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const name = process.argv[2];
const agentId = process.argv[3];

if (!name || !agentId) {
  console.log('Uso: node update-personality-agent.cjs "Nombre de Personalidad" "agent_id_de_elevenlabs"');
  process.exit(1);
}

async function main() {
  const result = await prisma.elevenLabsPersonality.updateMany({
    where: { name: name },
    data: { agentId: agentId }
  });

  if (result.count > 0) {
    console.log(`✅ Personalidad "${name}" actualizada con Agent ID: ${agentId}`);
  } else {
    console.log(`❌ No se encontró la personalidad "${name}"`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
