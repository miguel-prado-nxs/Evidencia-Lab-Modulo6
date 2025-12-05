/**
 * Script para agregar índices de búsqueda optimizados
 * Mejora el rendimiento de búsquedas de texto usando índices GIN con pg_trgm
 */

require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL_RESTAURANTES || process.env.DATABASE_URL,
    },
  },
});

async function addSearchIndexes() {
  console.log("🔧 Agregando índices de búsqueda optimizados...\n");

  try {
    // 1. Habilitar extensión pg_trgm para búsquedas de texto
    console.log("📌 Habilitando extensión pg_trgm...");
    await prisma.$executeRawUnsafe(`
      CREATE EXTENSION IF NOT EXISTS pg_trgm;
    `);
    console.log("   ✓ Extensión pg_trgm habilitada");

    // 2. Índice GIN para nombre de establecimiento
    console.log("\n📌 Creando índice GIN para nombres...");
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_establishments_name_gin 
      ON establishments USING gin(name gin_trgm_ops);
    `);
    console.log("   ✓ Índice idx_establishments_name_gin creado");

    // 3. Índice GIN para nombre de actividad
    console.log("\n📌 Creando índice GIN para actividades...");
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_establishments_activity_name_gin 
      ON establishments USING gin(activity_name gin_trgm_ops);
    `);
    console.log("   ✓ Índice idx_establishments_activity_name_gin creado");

    // 4. Índice GIN para nombre de municipio
    console.log("\n📌 Creando índice GIN para municipios...");
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_establishments_municipality_gin 
      ON establishments USING gin(municipality_name gin_trgm_ops);
    `);
    console.log("   ✓ Índice idx_establishments_municipality_gin creado");

    // 5. Índice GIN para nombre de estado
    console.log("\n📌 Creando índice GIN para estados...");
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_establishments_state_gin 
      ON establishments USING gin(state_name gin_trgm_ops);
    `);
    console.log("   ✓ Índice idx_establishments_state_gin creado");

    // 6. Índice para geo_zones nombre
    console.log("\n📌 Creando índice GIN para zonas geográficas...");
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_geo_zones_name_gin 
      ON geo_zones USING gin(name gin_trgm_ops);
    `);
    console.log("   ✓ Índice idx_geo_zones_name_gin creado");

    // 7. Índice compuesto para filtros comunes
    console.log("\n📌 Creando índice compuesto para filtros...");
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_establishments_filters
      ON establishments(activity_code, state_code, municipality_code);
    `);
    console.log("   ✓ Índice idx_establishments_filters creado");

    // 8. Índice para código de actividad (búsquedas por tipo)
    console.log("\n📌 Creando índice para código de actividad...");
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_establishments_activity_code
      ON establishments(activity_code);
    `);
    console.log("   ✓ Índice idx_establishments_activity_code creado");

    // Verificar índices creados
    console.log("\n📊 Verificando índices creados...");
    const indexes = await prisma.$queryRawUnsafe(`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename IN ('establishments', 'geo_zones')
      AND indexname LIKE 'idx_%'
      ORDER BY indexname;
    `);

    console.log("\n✅ ÍNDICES CREADOS:");
    console.log("═".repeat(60));
    indexes.forEach((idx) => {
      console.log(`  📌 ${idx.indexname}`);
    });
    console.log("═".repeat(60));

    // Analizar tablas para actualizar estadísticas
    console.log("\n📌 Actualizando estadísticas de tablas...");
    await prisma.$executeRawUnsafe(`ANALYZE establishments;`);
    await prisma.$executeRawUnsafe(`ANALYZE geo_zones;`);
    console.log("   ✓ Estadísticas actualizadas");

    console.log("\n🎉 ¡Índices de búsqueda agregados correctamente!");
    console.log("   Las búsquedas de texto ahora serán mucho más rápidas.");

  } catch (error) {
    console.error("❌ Error:", error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

addSearchIndexes();

