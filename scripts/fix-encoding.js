/**
 * Script para corregir problemas de encoding en la base de datos
 * Los caracteres especiales (acentos, ñ) no se importaron correctamente
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

// Mapeo de caracteres mal codificados a caracteres correctos
const encodingFixes = {
  // Vocales con acento
  "�": "á", // á mal codificado
  "é": "é",
  "í": "í", 
  "ó": "ó",
  "ú": "ú",
  "Á": "Á",
  "É": "É",
  "Í": "Í",
  "Ó": "Ó",
  "Ú": "Ú",
  // Ñ
  "ñ": "ñ",
  "Ñ": "Ñ",
  // Otros caracteres comunes
  "ü": "ü",
  "Ü": "Ü",
};

async function fixEncoding() {
  console.log("🔧 Iniciando corrección de encoding...\n");

  // Lista de campos de texto a corregir
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
    // Usar SQL raw para hacer las correcciones masivas de forma eficiente
    console.log("📝 Corrigiendo caracteres en la base de datos...\n");

    // Correcciones más comunes basadas en el encoding Latin1 -> UTF8
    const corrections = [
      // á (Latin1 0xE1 interpretado como UTF8)
      { from: "á", to: "á" },
      { from: "Ã¡", to: "á" },
      // é
      { from: "é", to: "é" },
      { from: "Ã©", to: "é" },
      // í
      { from: "í", to: "í" },
      { from: "Ã­", to: "í" },
      // ó
      { from: "ó", to: "ó" },
      { from: "Ã³", to: "ó" },
      // ú
      { from: "ú", to: "ú" },
      { from: "Ãº", to: "ú" },
      // ñ
      { from: "ñ", to: "ñ" },
      { from: "Ã±", to: "ñ" },
      // Ñ
      { from: "Ñ", to: "Ñ" },
      // ü
      { from: "ü", to: "ü" },
      { from: "Ã¼", to: "ü" },
    ];

    for (const field of textFields) {
      console.log(`  📌 Corrigiendo campo: ${field}`);
      
      for (const { from, to } of corrections) {
        try {
          const result = await prisma.$executeRawUnsafe(
            `UPDATE establishments SET "${field}" = REPLACE("${field}", $1, $2) WHERE "${field}" LIKE $3`,
            from,
            to,
            `%${from}%`
          );
          if (result > 0) {
            console.log(`     ✓ Reemplazado "${from}" → "${to}": ${result} registros`);
          }
        } catch (err) {
          // Ignorar errores de campos que no existen
        }
      }
    }

    // Verificar resultados
    console.log("\n📊 Verificando resultados...");
    
    const sample = await prisma.establishment.findMany({
      take: 5,
      select: {
        name: true,
        activityName: true,
        municipalityName: true,
        stateName: true,
      },
    });

    console.log("\n📋 Muestra de datos corregidos:");
    sample.forEach((e, i) => {
      console.log(`   ${i + 1}. ${e.name}`);
      console.log(`      ${e.activityName}`);
      console.log(`      ${e.municipalityName}, ${e.stateName}\n`);
    });

    console.log("✅ Corrección de encoding completada!");

  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

fixEncoding();

