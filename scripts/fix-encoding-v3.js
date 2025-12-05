/**
 * Script para corregir encoding - usando nombres de columna correctos (snake_case)
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

// Mapeo de caracteres mal codificados (Latin1 interpretado como UTF8)
const replacements = [
  // Vocales con acento - secuencias comunes de Latin1 mal interpretado
  ["Ã¡", "á"],
  ["Ã©", "é"],
  ["Ã­", "í"],
  ["Ã³", "ó"],
  ["Ãº", "ú"],
  ["Ã±", "ñ"],
  ["Ã¼", "ü"],
  // Mayúsculas
  ["Ã\x81", "Á"],
  ["Ã\x89", "É"],
  ["Ã\x8D", "Í"],
  ["Ã\x93", "Ó"],
  ["Ã\x9A", "Ú"],
  ["Ã\x91", "Ñ"],
];

async function fixEncoding() {
  console.log("🔧 Corrigiendo encoding en la base de datos...\n");

  // Nombres de columnas reales en PostgreSQL (snake_case)
  const columns = [
    "name",
    "business_name",
    "activity_name",
    "neighborhood",
    "state_name",
    "municipality_name",
    "locality_name",
    "street_name",
  ];

  try {
    let totalFixed = 0;

    for (const column of columns) {
      console.log(`📌 Procesando: ${column}`);
      
      for (const [from, to] of replacements) {
        try {
          const result = await prisma.$executeRawUnsafe(
            `UPDATE establishments SET "${column}" = REPLACE("${column}", $1, $2) WHERE "${column}" LIKE $3`,
            from,
            to,
            `%${from}%`
          );
          if (result > 0) {
            console.log(`   ✓ "${from}" → "${to}": ${result} registros`);
            totalFixed += result;
          }
        } catch (err) {
          // Ignorar errores
        }
      }
    }

    console.log(`\n✅ Total de correcciones: ${totalFixed}`);

    // Verificar muestra
    console.log("\n📋 Muestra de datos corregidos:");
    const sample = await prisma.establishment.findMany({
      where: {
        OR: [
          { state_name: { contains: "xico" } },
          { activity_name: { contains: "Cafeter" } },
        ]
      },
      take: 5,
      select: {
        name: true,
        activity_name: true,
        municipality_name: true,
        state_name: true,
      },
    });

    sample.forEach((e, i) => {
      console.log(`   ${i + 1}. ${e.name}`);
      console.log(`      ${e.activity_name}`);
      console.log(`      ${e.municipality_name}, ${e.state_name}\n`);
    });

  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

fixEncoding();

