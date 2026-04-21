const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const prismaGeo = new PrismaClient({
  datasources: {
    db: {
      url: process.env.GEO_DATABASE_URL,
    },
  },
});

async function debugEligibility() {
  try {
    // 1. Obtener establecimientos con enriquecimiento discovery_completed
    const enrichedEstablishments = await prisma.establishmentEnrichment.findMany({
      where: {
        enrichmentStatus: "discovery_completed",
      },
      select: {
        establishmentId: true,
        enrichmentStatus: true,
      },
      take: 10,
    });

    console.log("\n=== ESTABLECIMIENTOS CON DISCOVERY_COMPLETED ===");
    console.log(`Total encontrados: ${enrichedEstablishments.length}`);
    console.log("IDs:", enrichedEstablishments.map(e => e.establishmentId));

    // 2. Verificar si estos IDs existen en la BD geo
    if (enrichedEstablishments.length > 0) {
      const enrichedIds = enrichedEstablishments.map(e => e.establishmentId);
      
      const geoEstablishments = await prismaGeo.establishment.findMany({
        where: {
          id: { in: enrichedIds },
        },
        select: {
          id: true,
          name: true,
          latitude: true,
          longitude: true,
        },
      });

      console.log("\n=== ESTABLECIMIENTOS EN BD GEO ===");
      console.log(`Encontrados en geo: ${geoEstablishments.length}`);
      console.log(JSON.stringify(geoEstablishments, null, 2));

      // 3. Si no hay coincidencia, buscar por nombre
      if (geoEstablishments.length === 0) {
        console.log("\n⚠️ NO HAY COINCIDENCIA DE IDs");
        console.log("Intentando buscar por nombre en los primeros registros...");
        
        for (const enriched of enrichedEstablishments.slice(0, 3)) {
          const byId = await prismaGeo.establishment.findUnique({
            where: { id: enriched.establishmentId },
          });
          
          console.log(`\nID ${enriched.establishmentId}:`);
          console.log(`  Existe en geo: ${byId ? 'SÍ' : 'NO'}`);
        }
      }
    }

    // 4. Contar total de registros en ambas BDs
    const totalEnrichment = await prisma.establishmentEnrichment.count();
    const totalGeo = await prismaGeo.establishment.count();

    console.log("\n=== TOTALES ===");
    console.log(`Total en establishmentEnrichment: ${totalEnrichment}`);
    console.log(`Total en establishment (geo): ${totalGeo}`);

  } catch (error) {
    console.error("Error:", error.message);
  } finally {
    await prisma.$disconnect();
    await prismaGeo.$disconnect();
  }
}

debugEligibility();
