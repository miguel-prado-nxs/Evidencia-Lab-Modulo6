const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function runMigration() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });

  try {
    console.log('Conectando a la base de datos...');
    await client.connect();
    console.log('Conectado.\n');

    const migrationPath = path.join(
      __dirname,
      '..',
      'migrations',
      '20260622_add_interaction_type_to_twenty_sync_job',
      'migration.sql'
    );
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log('Ejecutando migracion...');
    await client.query(sql);
    console.log('Migracion ejecutada.\n');

    // Verificar columnas agregadas
    const cols = await client.query(`
      SELECT column_name, data_type, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'twenty_sync_jobs'
        AND column_name IN ('type', 'payload', 'dedupe_key', 'max_attempts')
      ORDER BY column_name;
    `);

    console.log('Columnas verificadas:');
    cols.rows.forEach((r) =>
      console.log(`  ${r.column_name} (${r.data_type}, default: ${r.column_default}, nullable: ${r.is_nullable})`)
    );

    // Verificar jobs existentes no fueron alterados
    const existing = await client.query(`
      SELECT COUNT(*) as total,
             COUNT(*) FILTER (WHERE type = 'PIPELINE') as pipeline_count
      FROM twenty_sync_jobs;
    `);
    const { total, pipeline_count } = existing.rows[0];
    console.log(`\nJobs existentes: ${total} total, ${pipeline_count} con type=PIPELINE`);

    if (total === pipeline_count) {
      console.log('OK: todos los jobs existentes conservan type=PIPELINE.');
    } else {
      console.log('ADVERTENCIA: hay jobs sin type=PIPELINE — revisar manualmente.');
    }

    // Verificar indice compuesto
    const idx = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'twenty_sync_jobs'
        AND indexname = 'twenty_sync_jobs_type_status_next_run_at_idx';
    `);
    console.log('\nIndice compuesto:', idx.rows.length ? 'creado' : 'NO encontrado — revisar');

    console.log('\nMigracion T003 completada. Ejecuta: npm run db:generate');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
