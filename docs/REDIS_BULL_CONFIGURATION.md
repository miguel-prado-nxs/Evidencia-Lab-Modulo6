# Configuración de Infraestructura Redis y Bull

Documentación técnica de la historia "Configuración de Infraestructura Redis y Bull", parte de la épica **Implementación de Sistema de Colas para A/B Testing Escalable (+400 llamadas)**.

---

## Contexto

El sistema de A/B testing ejecutaba llamadas de forma síncrona desde `abTestsService.js`, lo que saturaba los agentes SDR y Calificación al superar decenas de contactos. Esta historia establece la base de infraestructura (Redis + Bull Queue) sobre la cual se construirán las colas de procesamiento asíncrono en historias posteriores.

---

## Dependencias instaladas

| Paquete               | Versión  | Propósito                                           |
|-----------------------|----------|-----------------------------------------------------|
| `bull`                | ^4.16.5  | Gestión de colas de trabajo basada en Redis          |
| `ioredis`             | ^5.9.3   | Cliente Redis para Node.js (usado por Bull y health checks) |
| `@bull-board/api`     | ^6.18.0  | API del dashboard de monitoreo de colas              |
| `@bull-board/express` | ^6.18.0  | Adaptador Express para Bull Board                    |

Instalación:

```bash
npm install bull ioredis @bull-board/api @bull-board/express
```

---

## Variables de entorno

Agregadas en `.env`:

| Variable         | Valor por defecto          | Descripción                                          |
|------------------|----------------------------|------------------------------------------------------|
| `REDIS_URL`      | `redis://localhost:6381`   | URL completa de conexión a Redis (formato URI)        |
| `REDIS_HOST`     | `localhost`                | Host del servidor Redis (fallback si no hay URL)      |
| `REDIS_PORT`     | `6381`                     | Puerto del servidor Redis                             |
| `REDIS_PASSWORD`  | *(vacío)*                 | Contraseña de autenticación Redis (vacía en local)    |

Para **Railway (producción)**: configurar `REDIS_URL` con la URL proporcionada por el servicio Redis de Railway (formato `redis://default:password@host:port`).

---

## Estructura de archivos

```
src/
  config/
    env.js              # Sección `redis` agregada al objeto de configuración
  queues/               # Directorio nuevo
    config.js           # Conexión Redis y opciones por defecto de Bull
    sdrCallQueue.js     # Definicion de la cola "sdr-calls"
    qualificationCallQueue.js  # Definicion de la cola "qualification-calls"
    dashboard.js        # Setup de Bull Board (dashboard de monitoreo)
    index.js            # Re-exportación centralizada
```

---

## Configuración centralizada

### `src/config/env.js`

Se agregó la sección `redis` al objeto de configuración existente:

```javascript
redis: {
  url: process.env.REDIS_URL || "redis://localhost:6381",
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379", 10),
  password: process.env.REDIS_PASSWORD || null,
},
```

### `src/queues/config.js`

Módulo central que exporta:

| Exportación          | Tipo      | Descripción                                               |
|----------------------|-----------|-----------------------------------------------------------|
| `redisConfig`        | Objeto    | Configuración de conexión con `host`, `port`, `password`   |
| `createRedisClient()`| Función   | Factory que retorna una instancia nueva de ioredis         |
| `defaultJobOptions`  | Objeto    | Opciones por defecto para jobs (reintentos, backoff, limpieza) |
| `getBullOptions()`   | Función   | Retorna opciones para instanciar colas de Bull             |
| `getHealthClient()`  | Función   | Retorna un cliente ioredis singleton para health checks    |

**Opciones por defecto de jobs:**

```javascript
{
  attempts: 3,                    // Máximo 3 intentos por job
  backoff: {
    type: "exponential",          // Espera exponencial entre reintentos
    delay: 5000,                  // Delay base de 5 segundos
  },
  removeOnComplete: 100,          // Mantiene los últimos 100 jobs completados
  removeOnFail: 200,              // Mantiene los últimos 200 jobs fallidos
}
```

Notas sobre la configuración de Redis para Bull:
- `maxRetriesPerRequest: null` es requerido por Bull para evitar errores de timeout.
- `enableReadyCheck: false` evita bloqueos al iniciar la conexión en entornos donde Redis tarda en responder.

---

## Colas definidas

Se crearon dos instancias de Bull Queue con eventos de logging configurados:

| Cola                   | Nombre en Redis          | Propósito                            |
|------------------------|--------------------------|--------------------------------------|
| `sdrCallQueue`         | `sdr-calls`              | Llamadas de agentes SDR              |
| `qualificationCallQueue` | `qualification-calls` | Llamadas de agentes de Calificación  |

Ambas colas registran eventos vía Winston logger:

- `error`: errores de conexión o procesamiento.
- `waiting`: job encolado y esperando.
- `active`: job siendo procesado por un worker.
- `completed`: job finalizado con éxito.
- `failed`: job fallido (incluye número de intentos).
- `stalled`: job estancado por posible crash del worker.

Cada cola expone una función `getQueueStats()` que retorna conteos por estado (`waiting`, `active`, `completed`, `failed`, `delayed`, `total`).

> **Nota:** Las funciones de encolamiento (`enqueue*`) y los procesadores (`process()`) se implementarán en las historias de "Implementación de Queues SDR y Qualification" e "Implementación de Workers de Procesamiento", respectivamente.

---

## Bull Board (Dashboard de monitoreo)

Se configuro Bull Board como middleware Express, accesible en:

```
http://localhost:3004/admin/queues
```

El dashboard permite:
- Ver jobs pendientes, activos, completados, fallidos y estancados.
- Reintentar jobs fallidos manualmente.
- Limpiar colas.
- Inspeccionar datos de cada job.

**Integración en `app.js`:**

Bull Board se monta antes de las rutas de la API y fuera del rate limiter (`/api/`), por lo que el dashboard no está sujeto a restricciones de tasa de requests.

> **Nota:** Actualmente el dashboard no tiene autenticación. Se recomienda agregar un middleware de autenticación admin antes del deploy a producción.

---

## Health check con Redis

El endpoint `GET /health` ahora incluye el estado de la conexión a Redis:

```json
{
  "success": true,
  "message": "EasyOrder Partners API está funcionando correctamente",
  "timestamp": "2026-02-13T...",
  "environment": "development",
  "redis": "connected"
}
```

El campo `redis` puede ser `"connected"` o `"disconnected"`. Utiliza un cliente ioredis singleton para evitar crear conexiones por cada request.

---

## Script de verificación

Se agregó el script `redis:check` en `package.json` para validar rápidamente la conexión a Redis:

```bash
npm run redis:check
# Respuesta esperada: Redis: PONG
```

---

## Requisitos para desarrollo local

### Opción A: Redis con Docker (recomendada)

```bash
docker run -d --name redis-ab-testing -p 6381:6379 redis:7-alpine
```

Verificar:

```bash
docker exec redis-ab-testing redis-cli ping
# PONG
```

### Opción B: Redis nativo

- **Windows (WSL2):** `sudo apt-get install redis-server && sudo service redis-server start`
- **macOS:** `brew install redis && brew services start redis`
- **Linux:** `sudo apt-get install redis-server && sudo systemctl start redis`

Verificar con:

```bash
redis-cli ping
# PONG
```

---

## Requisitos para Railway (producción)

1. Crear un servicio Redis en el dashboard de Railway.
2. Copiar la variable `REDIS_URL` generada automáticamente.
3. Configurar `REDIS_URL` en las variables de entorno del servicio `easyorder-partners-api`.
4. El formato típico es: `redis://default:password@host:port`.

---

## Verificación de la implementación

| Criterio                                     | Comando / acción                                | Estado |
|----------------------------------------------|--------------------------------------------------|--------|
| Redis responde en local                      | `npm run redis:check` retorna `PONG`            | Listo  |
| Bull instalado sin errores                   | `npm ls bull ioredis` muestra versiones          | Listo  |
| Configuración centralizada en `config.js`    | `src/queues/config.js` exporta todas las funciones | Listo |
| Bull Board accesible                         | Navegar a `http://localhost:3004/admin/queues`   | Listo  |
| Health check incluye estado Redis            | `GET /health` retorna campo `redis`              | Listo  |
| Variables de entorno documentadas            | Sección "Variables de entorno" de este documento | Listo  |

---

## Troubleshooting

### Redis no disponible al iniciar la API

Si Redis no está corriendo, la API iniciará normalmente pero:
- Las colas registrarán errores de conexión en los logs.
- El health check reportará `"redis": "disconnected"`.
- Bull Board mostrará las colas sin datos.

La API no se cae; Redis no es bloqueante para el arranque del servidor.

### Error "maxRetriesPerRequest" en Bull

Si se ve el error `MaxRetriesPerRequestError`, verificar que la configuración de Redis incluye `maxRetriesPerRequest: null`. Este valor ya está configurado en `src/queues/config.js`.

### Bull Board no carga en el navegador

Verificar que:
1. La API está corriendo (`npm run dev`).
2. La ruta es correcta: `/admin/queues` (no `/admin/queue`).
3. No hay un middleware bloqueando las rutas fuera de `/api/`.

### Conexión rechazada a Redis en Railway

Verificar que:
1. El servicio Redis está activo en Railway.
2. `REDIS_URL` está correctamente configurada en las variables de entorno.
3. El servicio `easyorder-partners-api` tiene acceso de red al servicio Redis (deben estar en el mismo proyecto o tener networking habilitado).
