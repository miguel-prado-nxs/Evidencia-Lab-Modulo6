/**
 * Script para crear índices GIN para búsqueda rápida de texto
 * Estos índices mejoran significativamente el rendimiento de búsquedas LIKE/ILIKE
 * 
 * Uso: node scripts/create-search-indexes.js
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

async function createIndexes() {
  console.log("🔧 Creando índices de búsqueda optimizados...\n");

  try {
    // 1. Habilitar extensión pg_trgm para búsqueda de trigramas
    console.log("📦 Habilitando extensión pg_trgm...");
    await prisma.$executeRawUnsafe(`
      CREATE EXTENSION IF NOT EXISTS pg_trgm;
    `);
    console.log("   ✓ Extensión pg_trgm habilitada\n");

    // 2. Índice GIN para nombre de establecimiento
    console.log("📍 Creando índice GIN para nombre de establecimiento...");
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_establishments_name_gin 
      ON establishments USING gin(name gin_trgm_ops);
    `);
    console.log("   ✓ Índice idx_establishments_name_gin creado\n");

    // 3. Índice GIN para nombre de actividad
    console.log("📍 Creando índice GIN para nombre de actividad...");
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_establishments_activity_name_gin 
      ON establishments USING gin(activity_name gin_trgm_ops);
    `);
    console.log("   ✓ Índice idx_establishments_activity_name_gin creado\n");

    // 4. Índice GIN para nombre de municipio
    console.log("📍 Creando índice GIN para nombre de municipio...");
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_establishments_municipality_gin 
      ON establishments USING gin(municipality_name gin_trgm_ops);
    `);
    console.log("   ✓ Índice idx_establishments_municipality_gin creado\n");

    // 5. Índice GIN para nombre de estado
    console.log("📍 Creando índice GIN para nombre de estado...");
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_establishments_state_gin 
      ON establishments USING gin(state_name gin_trgm_ops);
    `);
    console.log("   ✓ Índice idx_establishments_state_gin creado\n");

    // 6. Índice compuesto para filtros comunes
    console.log("📍 Creando índice compuesto para filtros...");
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_establishments_activity_state 
      ON establishments(activity_code, state_code);
    `);
    console.log("   ✓ Índice idx_establishments_activity_state creado\n");

    // 7. Índice para geo_zones búsqueda por nombre
    console.log("📍 Creando índice GIN para geo_zones...");
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_geo_zones_name_gin 
      ON geo_zones USING gin(name gin_trgm_ops);
    `);
    console.log("   ✓ Índice idx_geo_zones_name_gin creado\n");

    // 8. Índice para geo_zones por tipo y código
    console.log("📍 Creando índice compuesto para geo_zones...");
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_geo_zones_type_code 
      ON geo_zones(type, state_code, municipality_code);
    `);
    console.log("   ✓ Índice idx_geo_zones_type_code creado\n");

    // Verificar índices creados
    console.log("📊 Verificando índices creados...");
    const indexes = await prisma.$queryRaw`
      SELECT indexname, tablename 
      FROM pg_indexes 
      WHERE schemaname = 'public' 
      AND (tablename = 'establishments' OR tablename = 'geo_zones')
      ORDER BY tablename, indexname;
    `;

    console.log("\n✅ Índices en la base de datos:");
    console.log("────────────────────────────────────────────");
    indexes.forEach((idx) => {
      console.log(`   📌 ${idx.tablename}: ${idx.indexname}`);
    });
    console.log("────────────────────────────────────────────\n");

    // Analizar tablas para actualizar estadísticas
    console.log("📈 Actualizando estadísticas de tablas...");
    await prisma.$executeRawUnsafe(`ANALYZE establishments;`);
    await prisma.$executeRawUnsafe(`ANALYZE geo_zones;`);
    console.log("   ✓ Estadísticas actualizadas\n");

    console.log("🎉 ¡Todos los índices de búsqueda creados exitosamente!");
    console.log("\n💡 Los índices GIN mejoran las búsquedas ILIKE de O(n) a O(log n)");

  } catch (error) {
    console.error("❌ Error creando índices:", error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

createIndexes()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
