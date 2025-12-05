/**
 * Re-importar datos DENUE con encoding correcto (Latin1 -> UTF8)
 */

const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const iconv = require("iconv-lite");
require("dotenv").config();

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL_RESTAURANTES,
    },
  },
});

const DATA_DIR = path.join(__dirname, "..", "data");
const CSV_FILES = [
  path.join(DATA_DIR, "denue_00_72_1_csv", "conjunto_de_datos", "denue_inegi_72_1.csv"),
  path.join(DATA_DIR, "denue_00_72_2_csv", "conjunto_de_datos", "denue_inegi_72_2.csv"),
];
const BATCH_SIZE = 5000;

async function reimportData() {
  console.log("🚀 Re-importando datos DENUE con encoding correcto...\n");
  
  // Primero eliminar datos existentes
  console.log("🗑️  Eliminando datos existentes...");
  await prisma.leadProspect.deleteMany({});
  await prisma.establishment.deleteMany({});
  await prisma.geoZone.deleteMany({});
  console.log("✅ Datos eliminados\n");

  let totalImported = 0;
  const startTime = Date.now();

  for (const filePath of CSV_FILES) {
    console.log(`📂 Procesando: ${path.basename(filePath)}`);
    let batch = [];
    let lineCount = 0;

    await new Promise((resolve, reject) => {
      // Leer archivo con encoding Latin1 y convertir a UTF8
      fs.createReadStream(filePath)
        .pipe(iconv.decodeStream("latin1"))
        .pipe(csv())
        .on("data", async (row) => {
          lineCount++;

          if (lineCount % 50000 === 0) {
            process.stdout.write(`  ✅ ${lineCount} registros procesados...\r`);
          }

          const latitude = parseFloat(row.latitud);
          const longitude = parseFloat(row.longitud);

          if (isNaN(latitude) || isNaN(longitude) || latitude === 0 || longitude === 0) {
            return;
          }

          batch.push({
            id: row.id,
            clee: row.clee || null,
            name: row.nom_estab,
            business_name: row.raz_social || null,
            activity_code: row.codigo_act,
            activity_name: row.nombre_act,
            employee_range: row.per_ocu || null,
            address: `${row.tipo_vial || ""} ${row.nom_vial || ""} ${row.numero_ext || ""} ${row.colonia || ""}`.trim() || null,
            postal_code: row.cod_postal || null,
            neighborhood: row.nomb_asent || null,
            state_code: row.cve_ent,
            state_name: row.entidad,
            municipality_code: row.cve_mun,
            municipality_name: row.municipio,
            locality_code: row.cve_loc || null,
            locality_name: row.localidad || null,
            latitude: latitude,
            longitude: longitude,
            phone: row.telefono || null,
            email: row.correoelec || null,
            website: row.www || null,
            establishment_type: row.tipoUniEco || null,
            added_date: row.fecha_alta || null,
          });

          if (batch.length >= BATCH_SIZE) {
            try {
              await prisma.establishment.createMany({
                data: batch,
                skipDuplicates: true,
              });
              totalImported += batch.length;
              batch = [];
            } catch (error) {
              console.error("\n❌ Error en batch:", error.message);
              batch = [];
            }
          }
        })
        .on("end", async () => {
          if (batch.length > 0) {
            try {
              await prisma.establishment.createMany({
                data: batch,
                skipDuplicates: true,
              });
              totalImported += batch.length;
            } catch (error) {
              console.error("\n❌ Error en último batch:", error.message);
            }
          }
          console.log(`\n  📊 Archivo completado: ${lineCount} líneas`);
          resolve();
        })
        .on("error", reject);
    });
  }

  // Crear zonas geográficas
  console.log("\n📍 Creando zonas geográficas...");
  
  const states = await prisma.establishment.groupBy({
    by: ["state_code", "state_name"],
    _count: { id: true },
  });

  for (const state of states) {
    await prisma.geoZone.upsert({
      where: { id: state.state_code },
      update: { total_establishments: state._count.id },
      create: {
        id: state.state_code,
        name: state.state_name,
        type: "STATE",
        geometry: {},
        total_establishments: state._count.id,
      },
    });
  }
  console.log(`  ✅ ${states.length} estados creados`);

  const endTime = Date.now();
  const minutes = ((endTime - startTime) / 60000).toFixed(2);

  console.log("\n════════════════════════════════════");
  console.log(`✅ Importación completada!`);
  console.log(`📊 Total importados: ${totalImported.toLocaleString()}`);
  console.log(`⏱️  Tiempo: ${minutes} minutos`);
  console.log("════════════════════════════════════\n");

  // Verificar muestra
  const sample = await prisma.establishment.findMany({
    take: 5,
    select: {
      name: true,
      activity_name: true,
      municipality_name: true,
      state_name: true,
    },
  });

  console.log("📋 Muestra de datos:");
  sample.forEach((e, i) => {
    console.log(`   ${i + 1}. ${e.name} - ${e.activity_name}`);
    console.log(`      ${e.municipality_name}, ${e.state_name}\n`);
  });
}

reimportData()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

