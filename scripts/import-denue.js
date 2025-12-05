/**
 * Script de importación de datos DENUE (INEGI)
 * Importa ~801,000 establecimientos del sector restaurantero
 * 
 * Uso: node scripts/import-denue.js
 */

require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const iconv = require("iconv-lite"); // Para encoding Latin1

const prisma = new PrismaClient();

// Configuración
const BATCH_SIZE = 5000; // Registros por batch
const DATA_DIR = path.join(__dirname, "../data");

const CSV_FILES = [
  "denue_00_72_1_csv/conjunto_de_datos/denue_inegi_72_1.csv",
  "denue_00_72_2_csv/conjunto_de_datos/denue_inegi_72_2.csv",
];

// Mapeo de columnas CSV a campos de la DB
function parseCSVLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());

  return values;
}

function mapRowToEstablishment(values, headers) {
  const row = {};
  headers.forEach((header, index) => {
    row[header] = values[index] || null;
  });

  // Construir dirección completa
  const addressParts = [
    row.tipo_vial,
    row.nom_vial,
    row.numero_ext,
    row.letra_ext,
  ].filter(Boolean);

  const address = addressParts.join(" ").trim() || null;

  // Validar coordenadas
  const lat = parseFloat(row.latitud);
  const lng = parseFloat(row.longitud);

  if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) {
    return null; // Saltar registros sin coordenadas válidas
  }

  return {
    id: row.id,
    clee: row.clee || null,
    name: row.nom_estab || "Sin nombre",
    businessName: row.raz_social || null,
    activityCode: row.codigo_act || "000000",
    activityName: row.nombre_act || "No especificado",
    employeeRange: row.per_ocu || null,
    streetType: row.tipo_vial || null,
    streetName: row.nom_vial || null,
    exteriorNum: row.numero_ext || null,
    interiorNum: row.numero_int || null,
    neighborhood: row.nomb_asent || null,
    postalCode: row.cod_postal || null,
    stateCode: row.cve_ent || "00",
    stateName: row.entidad || "No especificado",
    municipalityCode: row.cve_mun || "000",
    municipalityName: row.municipio || "No especificado",
    localityCode: row.cve_loc || null,
    localityName: row.localidad || null,
    ageb: row.ageb || null,
    block: row.manzana || null,
    latitude: lat,
    longitude: lng,
    phone: row.telefono || null,
    email: row.correoelec || null,
    website: row.www || null,
    establishmentType: row.tipoUniEco || null,
    addedDate: row.fecha_alta || null,
  };
}

async function processCSVFile(filePath, stats) {
  console.log(`\n📂 Procesando: ${path.basename(filePath)}`);

  // Leer archivo con encoding Latin1 (ISO-8859-1) - el formato nativo de INEGI
  const fileStream = fs.createReadStream(filePath).pipe(iconv.decodeStream("latin1"));
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let headers = null;
  let batch = [];
  let lineCount = 0;
  let skipped = 0;

  for await (const line of rl) {
    lineCount++;

    // Primera línea son los headers
    if (lineCount === 1) {
      headers = parseCSVLine(line).map((h) => h.replace(/"/g, "").toLowerCase());
      continue;
    }

    const values = parseCSVLine(line);
    const establishment = mapRowToEstablishment(values, headers);

    if (establishment) {
      batch.push(establishment);
    } else {
      skipped++;
    }

    // Insertar batch cuando alcance el tamaño
    if (batch.length >= BATCH_SIZE) {
      try {
        await prisma.establishment.createMany({
          data: batch,
          skipDuplicates: true,
        });
        stats.imported += batch.length;
        process.stdout.write(`\r  ✅ ${stats.imported.toLocaleString()} registros importados...`);
      } catch (error) {
        console.error(`\n  ❌ Error en batch: ${error.message}`);
        stats.errors += batch.length;
      }
      batch = [];
    }
  }

  // Insertar último batch
  if (batch.length > 0) {
    try {
      await prisma.establishment.createMany({
        data: batch,
        skipDuplicates: true,
      });
      stats.imported += batch.length;
    } catch (error) {
      console.error(`\n  ❌ Error en último batch: ${error.message}`);
      stats.errors += batch.length;
    }
  }

  stats.skipped += skipped;
  stats.total += lineCount - 1; // Excluir header

  console.log(`\n  📊 Archivo completado: ${lineCount - 1} líneas procesadas, ${skipped} omitidas`);
}

async function createGeoZones() {
  console.log("\n📍 Creando zonas geográficas...");

  // Obtener estados únicos
  const states = await prisma.establishment.groupBy({
    by: ["stateCode", "stateName"],
    _count: { id: true },
    _avg: { latitude: true, longitude: true },
  });

  for (const state of states) {
    await prisma.geoZone.upsert({
      where: { id: `state-${state.stateCode}` },
      update: {
        totalEstablishments: state._count.id,
        centerLat: state._avg.latitude,
        centerLng: state._avg.longitude,
      },
      create: {
        id: `state-${state.stateCode}`,
        name: state.stateName,
        type: "STATE",
        stateCode: state.stateCode,
        totalEstablishments: state._count.id,
        centerLat: state._avg.latitude,
        centerLng: state._avg.longitude,
      },
    });
  }

  console.log(`  ✅ ${states.length} estados creados`);

  // Obtener municipios únicos (limitado a los top 100 por volumen)
  const municipalities = await prisma.establishment.groupBy({
    by: ["stateCode", "municipalityCode", "municipalityName", "stateName"],
    _count: { id: true },
    _avg: { latitude: true, longitude: true },
    orderBy: { _count: { id: "desc" } },
    take: 500, // Top 500 municipios
  });

  for (const mun of municipalities) {
    const id = `mun-${mun.stateCode}-${mun.municipalityCode}`;
    await prisma.geoZone.upsert({
      where: { id },
      update: {
        totalEstablishments: mun._count.id,
        centerLat: mun._avg.latitude,
        centerLng: mun._avg.longitude,
      },
      create: {
        id,
        name: `${mun.municipalityName}, ${mun.stateName}`,
        type: "MUNICIPALITY",
        stateCode: mun.stateCode,
        municipalityCode: mun.municipalityCode,
        totalEstablishments: mun._count.id,
        centerLat: mun._avg.latitude,
        centerLng: mun._avg.longitude,
      },
    });
  }

  console.log(`  ✅ ${municipalities.length} municipios creados`);
}

async function main() {
  console.log("🚀 Iniciando importación de datos DENUE...\n");
  console.log("================================================");

  const startTime = Date.now();
  const stats = {
    total: 0,
    imported: 0,
    skipped: 0,
    errors: 0,
  };

  // Verificar que existen los archivos
  for (const file of CSV_FILES) {
    const fullPath = path.join(DATA_DIR, file);
    if (!fs.existsSync(fullPath)) {
      console.error(`❌ Archivo no encontrado: ${fullPath}`);
      process.exit(1);
    }
  }

  // Procesar cada archivo CSV
  for (const file of CSV_FILES) {
    const fullPath = path.join(DATA_DIR, file);
    await processCSVFile(fullPath, stats);
  }

  // Crear zonas geográficas
  await createGeoZones();

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(2);

  console.log("\n================================================");
  console.log("📊 RESUMEN DE IMPORTACIÓN");
  console.log("================================================");
  console.log(`  📁 Registros totales: ${stats.total.toLocaleString()}`);
  console.log(`  ✅ Importados: ${stats.imported.toLocaleString()}`);
  console.log(`  ⏭️  Omitidos (sin coordenadas): ${stats.skipped.toLocaleString()}`);
  console.log(`  ❌ Errores: ${stats.errors.toLocaleString()}`);
  console.log(`  ⏱️  Tiempo total: ${elapsed} minutos`);
  console.log("================================================\n");

  // Verificar conteo final
  const totalInDB = await prisma.establishment.count();
  console.log(`🏢 Total de establecimientos en DB: ${totalInDB.toLocaleString()}`);

  const totalZones = await prisma.geoZone.count();
  console.log(`📍 Total de zonas geográficas: ${totalZones}`);
}

main()
  .catch((e) => {
    console.error("❌ Error fatal:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

