/**
 * Configuración de conexión a Redis y opciones por defecto para Bull Queue.
 *
 * Este módulo centraliza toda la configuración necesaria para que las colas
 * de Bull se conecten a Redis y compartan opciones consistentes de reintentos,
 * backoff y limpieza de jobs.
 */

const Redis = require('ioredis');
const config = require('../config/env');
const logger = require('../config/logger');

/**
 * Objeto de configuración de conexión Redis.
 * - maxRetriesPerRequest: null es requerido por Bull para evitar errores de timeout.
 * - enableReadyCheck: false evita bloqueos al iniciar la conexión.
 */
const redisConfig = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

/**
 * Crea y retorna una nueva instancia de cliente ioredis.
 * Utiliza REDIS_URL cuando esta disponible (formato: redis://user:pass@host:port).
 * En caso contrario, usa el objeto redisConfig con host/port/password individuales.
 *
 * @returns {Redis} Instancia de cliente ioredis conectada.
 */
function createRedisClient() {
  const client = config.redis.url
    ? new Redis(config.redis.url, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      })
    : new Redis(redisConfig);

  client.on('error', (err) => {
    logger.error('[Redis] Error de conexión:', { error: err.message });
  });

  client.on('connect', () => {
    logger.info('[Redis] Conexión establecida');
  });

  return client;
}

/**
 * Opciones por defecto aplicadas a cada job encolado.
 * - attempts: número máximo de reintentos ante fallo.
 * - backoff: estrategia de espera entre reintentos (exponencial, base 5s).
 * - removeOnComplete: mantiene los últimos N jobs completados para consulta.
 * - removeOnFail: mantiene los últimos N jobs fallidos para diagnóstico.
 */
const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 5000,
  },
  removeOnComplete: 100,
  removeOnFail: 200,
};

/**
 * Retorna las opciones de configuración para instanciar una cola de Bull.
 * Incluye la URL de conexión a Redis y las opciones por defecto de jobs.
 *
 * @returns {object} Opciones compatibles con el constructor de Bull Queue.
 */
function getBullOptions() {
  return {
    redis: config.redis.url || redisConfig,
    defaultJobOptions,
    settings: {
      // Tiempo máximo que un job puede estar bloqueado antes de considerarse estancado (ms)
      // Por defecto es 30000 (30s), aumentamos a 5 minutos para llamadas largas
      lockDuration: 300000, // 5 minutos

      // Intervalo de verificación de jobs estancados (ms)
      // Por defecto es 5000 (5s), aumentamos a 30s para reducir falsos positivos
      stalledInterval: 30000, // 30 segundos

      // Número máximo de veces que se verifica si un job está estancado
      // El job solo se marca como estancado después de maxStalledCount comprobaciones
      maxStalledCount: 2, // 2 comprobaciones antes de marcar como estancado
    },
  };
}

// Cliente singleton para health checks y operaciones directas
let _healthClient = null;

/**
 * Retorna un cliente Redis singleton destinado a health checks.
 * Evita crear una conexión nueva por cada request al endpoint /health.
 *
 * @returns {Redis} Instancia singleton de ioredis.
 */
function getHealthClient() {
  if (!_healthClient) {
    _healthClient = createRedisClient();
  }
  return _healthClient;
}

module.exports = {
  redisConfig,
  createRedisClient,
  defaultJobOptions,
  getBullOptions,
  getHealthClient,
};
