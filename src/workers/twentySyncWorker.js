/**
 * Twenty Sync Worker
 * Worker que procesa jobs de sincronizacion con Twenty CRM
 * 
 * Caracteristicas:
 * - Migración inicial one-time de registros existentes (solo primera vez)
 * - Polling periodico de jobs pendientes
 * - Procesamiento en serie para evitar rate limiting
 * - Backoff exponencial en caso de errores
 * - Solo se inicia si TWENTY_API_KEY esta configurada
 */

const config = require("../config/env");
const logger = require("../config/logger");
const prisma = require("../config/database");
const { PrismaClient: PrismaClientGeo } = require('@prisma/client-geo');
const { processPendingJobs, getSyncStats, enqueueSync } = require("../services/twenty/twentySyncService");
const twentyService = require("../services/twenty/twentyService");

const prismaGeo = new PrismaClientGeo();

let isRunning = false;
let intervalId = null;

/**
 * Ejecuta la migración inicial de registros existentes (solo primera vez)
 * Procesa registros en lotes pequeños con delays para no saturar Twenty API
 */
async function runInitialMigration() {
  try {
    // Verificar si ya se ejecutó la migración
    let metadata = await prisma.twentySyncMetadata.findUnique({
      where: { id: 'singleton' }
    });

    if (!metadata) {
      metadata = await prisma.twentySyncMetadata.create({
        data: { id: 'singleton' }
      });
    }

    if (metadata.initialMigrationCompleted) {
      logger.info("[TwentySyncWorker] Migración inicial ya completada previamente");
      return;
    }

    logger.info("[TwentySyncWorker] Iniciando migración inicial de registros existentes");
    
    // Marcar como iniciada
    await prisma.twentySyncMetadata.update({
      where: { id: 'singleton' },
      data: { 
        initialMigrationStartedAt: new Date()
      }
    });

    // Obtener registros a migrar (solo niveles enriquecidos)
    const enrichments = await prisma.establishmentEnrichment.findMany({
      where: {
        level: { not: 'ESTABLISHMENT' }
      },
      orderBy: { createdAt: 'asc' }
    });

    logger.info(`[TwentySyncWorker] ${enrichments.length} registros a migrar`);
    
    let migrated = 0;
    let failed = 0;

    // Procesar en lotes de 10 con delay de 2 segundos entre lotes
    const BATCH_SIZE = 10;
    const BATCH_DELAY_MS = 2000;

    for (let i = 0; i < enrichments.length; i += BATCH_SIZE) {
      const batch = enrichments.slice(i, i + BATCH_SIZE);
      
      logger.info(`[TwentySyncWorker] Procesando lote ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(enrichments.length/BATCH_SIZE)}`);

      for (const enrichment of batch) {
        try {
          // Verificar si el establishment existe en BD geo
          const establishment = await prismaGeo.establishment.findUnique({
            where: { id: enrichment.establishmentId }
          });

          if (!establishment || !establishment.clee) {
            logger.warn(`[TwentySyncWorker] Establecimiento sin clee: ${enrichment.establishmentId}`);
            failed++;
            continue;
          }

          // Verificar si ya tiene TwentySyncState
          const existingState = await prisma.twentySyncState.findUnique({
            where: { establishmentId: enrichment.establishmentId }
          });

          if (existingState?.twentyEstablecimientoId) {
            // Ya migrado, solo encolar sync del nivel actual
            await enqueueSync({
              establishmentId: enrichment.establishmentId,
              partnerId: enrichment.enrichedBy,
              reason: `BACKFILL_${enrichment.level}`
            });
          } else {
            // No migrado, buscar/crear en Twenty
            let twentyEstablishment = await twentyService.findEstablecimientoByClaveDenue(establishment.clee);
            
            // Si no existe en Twenty, se creará automáticamente en la primera sync
            // Solo encolamos el job, el sync service se encargará de crear si no existe
            await enqueueSync({
              establishmentId: enrichment.establishmentId,
              partnerId: enrichment.enrichedBy,
              reason: `MIGRATION_${enrichment.level}`
            });
          }

          migrated++;
        } catch (error) {
          logger.error(`[TwentySyncWorker] Error migrando ${enrichment.establishmentId}:`, error.message);
          failed++;
        }
      }

      // Delay entre lotes para no saturar API
      if (i + BATCH_SIZE < enrichments.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    // Marcar como completada
    await prisma.twentySyncMetadata.update({
      where: { id: 'singleton' },
      data: {
        initialMigrationCompleted: true,
        initialMigrationCompletedAt: new Date(),
        totalRecordsMigrated: migrated
      }
    });

    logger.info(`[TwentySyncWorker] Migración inicial completada: ${migrated} encolados, ${failed} fallidos`);
    logger.info("[TwentySyncWorker] Los registros serán procesados gradualmente por el worker");

  } catch (error) {
    logger.error("[TwentySyncWorker] Error en migración inicial:", error);
    
    // Guardar error pero no marcar como completada
    await prisma.twentySyncMetadata.update({
      where: { id: 'singleton' },
      data: {
        lastMigrationError: error.message
      }
    }).catch(() => {});
  }
}

/**
 * Inicia el worker de sincronizacion
 */
async function start() {
  if (!config.twenty.apiKey) {
    logger.info("[TwentySyncWorker] TWENTY_API_KEY no configurada - worker no iniciado");
    return;
  }

  if (!config.twenty.syncEnabled) {
    logger.info("[TwentySyncWorker] Sync deshabilitado por configuracion");
    return;
  }

  if (isRunning) {
    logger.warn("[TwentySyncWorker] Worker ya esta corriendo");
    return;
  }

  isRunning = true;
  const intervalMs = config.twenty.syncIntervalMs || 10000;

  logger.info("[TwentySyncWorker] Iniciando worker de sincronizacion", {
    intervalMs,
    baseUrl: config.twenty.baseUrl,
  });

  // Ejecutar migración inicial de forma asíncrona (no bloquea el inicio)
  runInitialMigration().catch(error => {
    logger.error("[TwentySyncWorker] Error crítico en migración inicial:", error);
  });

  // Ejecutar primer ciclo de procesamiento después de 5 segundos
  setTimeout(runCycle, 5000);

  // Configurar intervalo para ciclos subsecuentes
  intervalId = setInterval(runCycle, intervalMs);
}

/**
 * Detiene el worker
 */
function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  isRunning = false;
  logger.info("[TwentySyncWorker] Worker detenido");
}

/**
 * Ejecuta un ciclo de procesamiento
 */
async function runCycle() {
  try {
    const result = await processPendingJobs(5); // Procesar hasta 5 jobs por ciclo

    if (result.processed > 0) {
      logger.info("[TwentySyncWorker] Ciclo completado", {
        processed: result.processed,
        success: result.success,
        failed: result.failed,
      });
    }
  } catch (error) {
    logger.error("[TwentySyncWorker] Error en ciclo de procesamiento", {
      error: error.message,
    });
  }
}

/**
 * Obtiene el estado del worker
 */
async function getStatus() {
  const stats = await getSyncStats();
  
  // Obtener metadata de migración
  const metadata = await prisma.twentySyncMetadata.findUnique({
    where: { id: 'singleton' }
  });

  return {
    isRunning,
    intervalMs: config.twenty.syncIntervalMs,
    enabled: config.twenty.syncEnabled,
    hasApiKey: !!config.twenty.apiKey,
    initialMigration: {
      completed: metadata?.initialMigrationCompleted || false,
      startedAt: metadata?.initialMigrationStartedAt,
      completedAt: metadata?.initialMigrationCompletedAt,
      totalRecordsMigrated: metadata?.totalRecordsMigrated || 0,
      lastError: metadata?.lastMigrationError
    },
    ...stats,
  };
}

module.exports = {
  start,
  stop,
  getStatus,
};
