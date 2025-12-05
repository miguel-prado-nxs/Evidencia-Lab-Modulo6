require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  console.log("🔍 Verificando datos en la base de datos...\n");

  const establishments = await prisma.establishment.count();
  console.log(`📊 Establecimientos: ${establishments.toLocaleString()}`);

  const zones = await prisma.geoZone.count();
  console.log(`🗺️  Zonas geográficas: ${zones.toLocaleString()}`);

  const states = await prisma.geoZone.count({ where: { type: "STATE" } });
  console.log(`   - Estados: ${states}`);

  const municipalities = await prisma.geoZone.count({ where: { type: "MUNICIPALITY" } });
  console.log(`   - Municipios: ${municipalities}`);

  // Muestra algunos establecimientos de ejemplo
  const samples = await prisma.establishment.findMany({
    take: 5,
    select: {
      name: true,
      activityName: true,
      stateName: true,
      municipalityName: true,
    },
  });

  console.log("\n📋 Ejemplos de establecimientos:");
  samples.forEach((e, i) => {
    console.log(`   ${i + 1}. ${e.name} (${e.activityName}) - ${e.municipalityName}, ${e.stateName}`);
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

