/**
 * Script para crear índices GIN de PostgreSQL para búsquedas rápidas
 * Mejora rendimiento de búsquedas parciales de O(n) a O(log n)
 * 
 * Uso: DATABASE_URL=... node scripts/create-indexes.js
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
  console.log("🔧 Creando índices GIN para búsquedas optimizadas...\n");

  try {
    // 1. Habilitar extensión pg_trgm para búsquedas por trigramas
    console.log("📦 Habilitando extensión pg_trgm...");
    await prisma.$executeRawUnsafe(`
      CREATE EXTENSION IF NOT EXISTS pg_trgm;
    `);
    console.log("   ✅ Extensión pg_trgm habilitada");

    // 2. Índice GIN para nombre del establecimiento
    console.log("\n📍 Creando índice GIN para nombre de establecimientos...");
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_establishments_name_gin 
        ON establishments USING gin(name gin_trgm_ops);
      `);
      console.log("   ✅ Índice idx_establishments_name_gin creado");
    } catch (e) {
      if (e.message.includes("already exists")) {
        console.log("   ⏭️  Índice ya existe, omitiendo...");
      } else {
        throw e;
      }
    }

    // 3. Índice GIN para nombre del municipio
    console.log("\n📍 Creando índice GIN para municipios...");
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_establishments_municipality_gin 
        ON establishments USING gin(municipality_name gin_trgm_ops);
      `);
      console.log("   ✅ Índice idx_establishments_municipality_gin creado");
    } catch (e) {
      if (e.message.includes("already exists")) {
        console.log("   ⏭️  Índice ya existe, omitiendo...");
      } else {
        throw e;
      }
    }

    // 4. Índice GIN para nombre de la actividad
    console.log("\n📍 Creando índice GIN para tipo de actividad...");
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_establishments_activity_gin 
        ON establishments USING gin(activity_name gin_trgm_ops);
      `);
      console.log("   ✅ Índice idx_establishments_activity_gin creado");
    } catch (e) {
      if (e.message.includes("already exists")) {
        console.log("   ⏭️  Índice ya existe, omitiendo...");
      } else {
        throw e;
      }
    }

    // 5. Índice GIN para nombre del estado
    console.log("\n📍 Creando índice GIN para estados...");
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_establishments_state_gin 
        ON establishments USING gin(state_name gin_trgm_ops);
      `);
      console.log("   ✅ Índice idx_establishments_state_gin creado");
    } catch (e) {
      if (e.message.includes("already exists")) {
        console.log("   ⏭️  Índice ya existe, omitiendo...");
      } else {
        throw e;
      }
    }

    // 6. Índice GIN para zonas geográficas
    console.log("\n📍 Creando índice GIN para geo_zones...");
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_geo_zones_name_gin 
        ON geo_zones USING gin(name gin_trgm_ops);
      `);
      console.log("   ✅ Índice idx_geo_zones_name_gin creado");
    } catch (e) {
      if (e.message.includes("already exists")) {
        console.log("   ⏭️  Índice ya existe, omitiendo...");
      } else {
        throw e;
      }
    }

    // 7. Índice compuesto para búsquedas por código de actividad
    console.log("\n📍 Creando índice B-tree para código de actividad...");
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_establishments_activity_code 
        ON establishments (activity_code);
      `);
      console.log("   ✅ Índice idx_establishments_activity_code creado");
    } catch (e) {
      if (e.message.includes("already exists")) {
        console.log("   ⏭️  Índice ya existe, omitiendo...");
      } else {
        throw e;
      }
    }

    // Verificar índices creados
    console.log("\n📊 Verificando índices creados...");
    const indexes = await prisma.$queryRaw`
      SELECT indexname, tablename 
      FROM pg_indexes 
      WHERE schemaname = 'public' 
      AND (indexname LIKE '%gin%' OR indexname LIKE '%activity_code%')
      ORDER BY tablename, indexname;
    `;

    console.log("\n✅ Índices activos:");
    indexes.forEach((idx) => {
      console.log(`   • ${idx.tablename}: ${idx.indexname}`);
    });

    console.log("\n🎉 Proceso completado exitosamente!");
    console.log("   Las búsquedas ahora serán significativamente más rápidas.\n");

  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

createIndexes();

