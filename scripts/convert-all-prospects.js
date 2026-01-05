/**
 * Script para convertir TODOS los prospectos ASSIGNED a Lead en batch
 * Util despues del fix para procesar todos los prospectos pendientes
 */

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function convertAllProspects() {
  console.log("=== CONVERTIR PROSPECTOS ASIGNADOS A LEADS ===\n");

  try {
    // 1. Buscar todos los prospectos ASSIGNED
    const prospects = await prisma.leadProspect.findMany({
      where: { status: "ASSIGNED" },
      orderBy: { assignedAt: "asc" },
    });

    console.log(`Encontrados ${prospects.length} prospectos ASSIGNED\n`);

    if (prospects.length === 0) {
      console.log("No hay prospectos para convertir");
      return;
    }

    // Mostrar lista
    console.log("Prospectos a convertir:");
    prospects.forEach((p, i) => {
      console.log(`  [${i + 1}] ${p.establishmentId} - Partner: ${p.partnerId}`);
    });

    console.log("\nDeseas convertir TODOS estos prospectos a Lead?");
    console.log("IMPORTANTE: Esta accion convertira todos los prospectos y NO se puede deshacer.");
    console.log("\nSi quieres continuar, ejecuta el script con el argumento --confirm:");
    console.log("  node scripts/convert-all-prospects.js --confirm\n");

    if (!process.argv.includes("--confirm")) {
      console.log("Script detenido. Agrega --confirm para ejecutar la conversion.");
      return;
    }

    // 2. Convertir cada prospecto
    const geoService = require("../src/services/geoService");
    
    console.log("\nIniciando conversion en batch...\n");
    
    let created = 0;
    let errors = 0;
    const results = [];

    for (const prospect of prospects) {
      try {
        console.log(`[${created + errors + 1}/${prospects.length}] Convirtiendo ${prospect.establishmentId}...`);

        const lead = await geoService.convertProspectToLead(prospect.id, {
          contactName: "Contacto Principal",
          interests: ["POS"],
        });

        console.log(`  Lead creado: ${lead.businessName}`);
        results.push({
          prospectId: prospect.id,
          leadId: lead.id,
          businessName: lead.businessName,
          status: "success",
        });
        created++;
      } catch (error) {
        console.error(`  ERROR: ${error.message}`);
        results.push({
          prospectId: prospect.id,
          establishmentId: prospect.establishmentId,
          error: error.message,
          status: "error",
        });
        errors++;
      }
    }

    // 3. Resumen
    console.log("\n=== RESUMEN DE CONVERSION ===");
    console.log(`Total procesados: ${prospects.length}`);
    console.log(`Exitosos: ${created}`);
    console.log(`Errores: ${errors}`);

    if (errors > 0) {
      console.log("\nProspectos con errores:");
      results
        .filter(r => r.status === "error")
        .forEach(r => {
          console.log(`  - ${r.establishmentId}: ${r.error}`);
        });
    }

    // Verificar tabla final
    const totalLeads = await prisma.lead.count();
    console.log(`\nTotal leads en la base de datos: ${totalLeads}`);

  } catch (error) {
    console.error("\nERROR FATAL:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar
convertAllProspects()
  .then(() => {
    console.log("\nScript completado");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\nScript fallo:", error);
    process.exit(1);
  });
