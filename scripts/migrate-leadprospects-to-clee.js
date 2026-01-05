/**
 * Script para migrar lead_prospects.establishment_id de UUID a clee
 * 
 * Convierte los establishmentId que actualmente son UUIDs (Establishment.id)
 * a clee (Establishment.clee) para consistencia con establishment_enrichments
 * 
 * IMPORTANTE: Ejecutar ANTES de usar el nuevo codigo
 */

const { PrismaClient: PrismaClientPartners } = require("@prisma/client");
const { PrismaClient: PrismaClientGeo } = require('../node_modules/.prisma/client-geo');

const prismaPartners = new PrismaClientPartners();
const prismaGeo = new PrismaClientGeo();

async function migrateLeadProspectsToClees() {
  console.log("=== INICIANDO MIGRACION DE LEAD_PROSPECTS A CLEE ===\n");

  try {
    // 1. Obtener todos los lead_prospects
    const prospects = await prismaPartners.leadProspect.findMany();

    console.log(`Encontrados ${prospects.length} registros en lead_prospects\n`);

    if (prospects.length === 0) {
      console.log("No hay registros para migrar");
      return;
    }

    let migrated = 0;
    let errors = 0;
    let skipped = 0;

    // 2. Procesar cada prospect
    for (const prospect of prospects) {
      const currentEstablishmentId = prospect.establishmentId;

      try {
        // Verificar si ya es un clee (formato: NNNNNNNNNN - 10 digitos)
        if (/^\d{10}$/.test(currentEstablishmentId)) {
          console.log(`SKIP: ${prospect.id} - Ya usa clee: ${currentEstablishmentId}`);
          skipped++;
          continue;
        }

        // Buscar el establishment por UUID en Mapa DB
        const establishment = await prismaGeo.establishment.findFirst({
          where: { id: currentEstablishmentId },
          select: {
            id: true,
            clee: true,
            name: true,
          },
        });

        if (!establishment) {
          console.log(`ERROR: Prospect ${prospect.id} - Establishment UUID ${currentEstablishmentId} no encontrado en Mapa DB`);
          errors++;
          continue;
        }

        if (!establishment.clee) {
          console.log(`ERROR: Prospect ${prospect.id} - Establishment ${establishment.name} no tiene clee`);
          errors++;
          continue;
        }

        // Actualizar el establishmentId de UUID a clee
        await prismaPartners.leadProspect.update({
          where: { id: prospect.id },
          data: { establishmentId: establishment.clee },
        });

        console.log(`MIGRADO: ${prospect.id}`);
        console.log(`   UUID: ${currentEstablishmentId}`);
        console.log(`   Clee: ${establishment.clee}`);
        console.log(`   Nombre: ${establishment.name}\n`);

        migrated++;
      } catch (error) {
        console.error(`ERROR procesando prospect ${prospect.id}:`, error.message);
        errors++;
      }
    }

    // 3. Resumen
    console.log("\n=== RESUMEN DE MIGRACION ===");
    console.log(`Total registros: ${prospects.length}`);
    console.log(`Migrados: ${migrated}`);
    console.log(`Ya eran clee (omitidos): ${skipped}`);
    console.log(`Errores: ${errors}`);

    if (errors > 0) {
      console.log("\nHay registros con errores. Revisa el log arriba.");
    } else {
      console.log("\nMigracion completada exitosamente!");
    }
  } catch (error) {
    console.error("\nERROR FATAL durante la migracion:", error);
    throw error;
  } finally {
    await prismaPartners.$disconnect();
    await prismaGeo.$disconnect();
  }
}

// Ejecutar migracion
migrateLeadProspectsToClees()
  .then(() => {
    console.log("\nScript completado");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\nScript fallo:", error);
    process.exit(1);
  });
