/**
 * Script para corregir encoding usando CONVERT de PostgreSQL
 * Convierte de LATIN1 a UTF8 directamente en la DB
 */

const { PrismaClient } = require("@prisma/client");
require("dotenv").config();

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL_RESTAURANTES,
    },
  },
});

async function fixEncoding() {
  console.log("🔧 Iniciando corrección de encoding con CONVERT...\n");

  const textFields = [
    "name",
    "businessName", 
    "activityName",
    "address",
    "neighborhood",
    "stateName",
    "municipalityName",
    "localityName",
  ];

  try {
    for (const field of textFields) {
      console.log(`📌 Corrigiendo campo: ${field}`);
      
      try {
        // Convertir de LATIN1 a UTF8
        const result = await prisma.$executeRawUnsafe(`
          UPDATE establishments 
          SET "${field}" = convert_from(convert_to("${field}", 'LATIN1'), 'UTF8')
          WHERE "${field}" IS NOT NULL 
          AND "${field}" ~ '[\\x80-\\xFF]'
        `);
        console.log(`   ✓ ${result} registros actualizados`);
      } catch (err) {
        console.log(`   ⚠ Error en ${field}: ${err.message}`);
      }
    }

    // Verificar resultados
    console.log("\n📊 Verificando resultados...");
    
    const sample = await prisma.establishment.findMany({
      where: {
        OR: [
          { stateName: { contains: "xico" } },
          { activityName: { contains: "Cafeter" } },
        ]
      },
      take: 5,
      select: {
        name: true,
        activityName: true,
        municipalityName: true,
        stateName: true,
      },
    });

    console.log("\n📋 Muestra de datos:");
    sample.forEach((e, i) => {
      console.log(`   ${i + 1}. ${e.name}`);
      console.log(`      ${e.activityName}`);
      console.log(`      ${e.municipalityName}, ${e.stateName}\n`);
    });

    console.log("✅ Proceso completado!");

  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

fixEncoding();

