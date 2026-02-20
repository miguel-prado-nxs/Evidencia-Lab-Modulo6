# Sistema de Colas para A/B Testing Escalable

## Resumen Ejecutivo

Sistema de procesamiento asíncrono basado en Redis + Bull que permite ejecutar +400 llamadas simultáneas de A/B testing, respetando los límites de concurrencia de los agentes de voz:
- **SDR**: 3 llamadas concurrentes por instancia
- **Calificación**: 2 llamadas concurrentes por instancia

**Problema resuelto**: El sistema anterior ejecutaba llamadas de forma síncrona desde `abTestsService`, saturando los agentes y degradando la calidad de las conversaciones.

**Solución implementada**: Arquitectura de colas con workers desacoplados que procesan llamadas en background, garantizando control estricto de concurrencia, tolerancia a fallos y escalabilidad horizontal.

---

## Arquitectura del Sistema

### Flujo de Ejecución

```
1. Frontend crea test A/B con contactos
   └─> POST /api/v1/ab-tests

2. API encola trabajos en Redis (no ejecuta llamadas)
   └─> abTestsService.startTest()
       └─> enqueueSDRCall() / enqueueQualificationCall()

3. Workers procesan jobs respetando concurrencia
   └─> sdrCallWorker (3 concurrentes)
   └─> qualificationCallWorker (2 concurrentes)

4. Workers ejecutan llamadas a agentes de voz
   └─> POST /api/sdr/initiate-call
   └─> POST /api/qualification/initiate-call

5. Workers actualizan estados en BD
   └─> abTestContact: PENDING -> CALLED -> COMPLETED/FAILED
```

### Componentes Principales

**1. Colas (Bull + Redis)**
- `src/queues/sdrCallQueue.js` - Cola de llamadas SDR
- `src/queues/qualificationCallQueue.js` - Cola de llamadas Calificación
- `src/queues/config.js` - Configuración centralizada
- `src/queues/index.js` - Exportaciones públicas

**2. Workers**
- `src/workers/sdrCallWorker.js` - Procesa llamadas SDR (concurrencia: 3)
- `src/workers/qualificationCallWorker.js` - Procesa llamadas Calificación (concurrencia: 2)
- `src/startWorkers.js` - Punto de entrada para iniciar workers

**3. Servicios**
- `src/services/abTestsService.js` - Lógica de negocio A/B Testing
- `src/services/abTestMonitoringService.js` - Monitoreo en tiempo real (SSE)

**4. Controladores y Rutas**
- `src/controllers/abTestsController.js` - Endpoints HTTP
- `src/routes/abTestsRoutes.js` - Definición de rutas
- `/admin/queues` - Bull Board (dashboard visual)

---

## Configuración

### Variables de Entorno

#### Redis (Obligatorio)
```env
# Railway (Producción)
REDIS_URL=redis://default:password@host:port

# Local (Desarrollo)
REDIS_HOST=localhost
REDIS_PORT=6381
REDIS_PASSWORD=
```

#### Agentes de Voz (Obligatorio)
```env
# SDR Agent
SDR_AGENT_URL=https://plg-agente-sdr-js-dev.up.railway.app
SDR_API_KEY=sdr_9888e39e8394a2bce8ae5d317995bbd7ce41adce6560f849

# Qualification Agent
QUALIFICATION_AGENT_URL=https://plg-crmeo-agente-calificacion-js-dev.up.railway.app
QUALIFICATION_API_KEY=qual_key_placeholder
```

#### Base de Datos (Ya configurado)
```env
DATABASE_URL=postgresql://user:pass@host:port/db
```

### Configuración de Colas

**Archivo**: `src/queues/config.js`

```javascript
// Límites de concurrencia
SDR Queue: 3 llamadas simultáneas
Qualification Queue: 2 llamadas simultáneas

// Timeouts
lockDuration: 300000 (5 minutos)
stalledInterval: 30000 (30 segundos)

// Reintentos
attempts: 3
backoff: exponencial (1000ms * 2^attempt)
```

**Modificar concurrencia**:
```javascript
// En src/workers/sdrCallWorker.js (línea final)
sdrCallQueue.process(
  "sdr-call",
  3, // <-- Cambiar aquí
  processSDRCall
);
```

---

## Operación

### Desarrollo Local

#### 1. Iniciar Redis
```bash
# Usando Docker
docker run -d -p 6381:6379 redis:alpine

# Verificar
npm run redis:check
# Output esperado: Redis: PONG
```

#### 2. Iniciar API
```bash
npm run dev
# Corre en http://localhost:3004
```

#### 3. Iniciar Workers (Terminal separada)
```bash
npm run start:workers
# Output esperado:
# [info]: === Iniciando Workers de Procesamiento ===
# [info]: [SDR Worker] Iniciado con concurrencia de 3 llamadas
# [info]: [Qualification Worker] Iniciado con concurrencia de 2 llamadas
# [info]: === Todos los workers están activos ===
```

#### 4. Ejecutar Tests de Integración
```bash
npm run test:integration
# Valida: encolamiento, concurrencia, pausa, reanudación
```

### Producción (Railway)

**Configuración de servicios**:

1. **partners-api** (Servidor HTTP)
   - Comando: `npm start`
   - Expone endpoints REST y SSE
   - NO procesa trabajos de cola

2. **partners-api-workers** (Workers)
   - Comando: `npm run start:workers`
   - Procesa trabajos de cola
   - NO expone endpoints HTTP
   - Mismas variables de entorno que API

**Deploy**:
```bash
# Railway auto-deploys desde main
git push origin main

# Verificar en Railway dashboard:
# - partners-api: logs muestran "Server running on port 3004"
# - partners-api-workers: logs muestran "Workers activos"
```

---

## Uso del Sistema

### Crear y Ejecutar Test A/B

**Vía API**:
```javascript
// 1. Agregar contactos a candidatos
POST /api/v1/ab-tests/candidates/bulk
{
  "userId": "uuid-user",
  "establishmentIds": ["10037858", "10000456"]
}

// 2. Crear test
POST /api/v1/ab-tests
{
  "name": "Test Comparativo",
  "agentType": "QUALIFICATION",
  "establishmentIds": ["10037858", "10000456"],
  "variants": [
    {
      "agentConfigId": "uuid-config-1",
      "agentConfigName": "Arthur Morgan",
      "voiceId": "alloy",
      "percentage": 50
    },
    {
      "agentConfigId": "uuid-config-2",
      "agentConfigName": "SDR Colombiano",
      "voiceId": "echo",
      "percentage": 50
    }
  ]
}
// Response: { success: true, data: { id: "test-uuid" } }

// 3. Iniciar test (encola trabajos)
PATCH /api/v1/ab-tests/{testId}/start
// Workers comienzan a procesar automáticamente
```

**Vía Frontend**:
1. Acceder a `http://localhost:3000/testing-ab`
2. Usar `ABTestWizard` para configurar test
3. Seleccionar contactos y variantes
4. Click en "Crear Test" y "Iniciar Test"

### Monitorear Ejecución

**Bull Board (Dashboard Visual)**:
```
URL: http://localhost:3004/admin/queues
Funciones:
- Ver jobs en tiempo real (waiting, active, completed, failed)
- Reintentar jobs fallidos
- Limpiar colas
- Ver logs de cada job
```

**API Endpoints**:
```bash
# Estadísticas de colas
GET /api/v1/ab-tests/queue-stats
# Response:
# {
#   "sdr": { "waiting": 0, "active": 2, "completed": 15, ... },
#   "qualification": { "waiting": 5, "active": 2, "completed": 8, ... }
# }

# Progreso de test específico
GET /api/v1/ab-tests/{testId}/progress
# Response:
# {
#   "testName": "Test...",
#   "status": "RUNNING",
#   "overall": { "totalContacts": 10, "totalProcessed": 5, ... },
#   "variants": [...]
# }
```

**Monitoreo en Tiempo Real (SSE)**:

**Opción 1: Cliente Navegador (Frontend)**
```javascript
// Para uso en React, Vue, vanilla JS, etc.
const testId = 'uuid-del-test';
const eventSource = new EventSource(
  `http://localhost:3004/api/v1/ab-tests/${testId}/monitor-stream`
);

eventSource.addEventListener('connected', (event) => {
  const data = JSON.parse(event.data);
  console.log('Conectado:', data.connectionId);
});

eventSource.addEventListener('update', (event) => {
  const data = JSON.parse(event.data);
  console.log('Progreso:', data.test.overall.overallProgress + '%');
  console.log('Cola SDR activos:', data.queues.sdr.active);
  console.log('Cola Qualification activos:', data.queues.qualification.active);
});

eventSource.addEventListener('complete', (event) => {
  const data = JSON.parse(event.data);
  console.log('Test finalizado:', data.testId);
  eventSource.close();
});

eventSource.addEventListener('error', (event) => {
  console.error('Error en stream SSE');
  eventSource.close();
});
```

**Opción 2: Script Node.js (Testing/CLI)**
```bash
# Usar script incluido para testing
node scripts/test-sse-monitoring.js <test-id>

# Monitorear colas globales (sin test-id)
node scripts/test-sse-monitoring.js
```

### Controlar Tests

```bash
# Pausar test (detiene encolamiento de nuevos jobs)
POST /api/v1/ab-tests/{testId}/pause

# Reanudar test
POST /api/v1/ab-tests/{testId}/resume

# Obtener lista de tests
GET /api/v1/ab-tests?status=RUNNING

# Ver conexiones SSE activas (debugging)
GET /api/v1/ab-tests/monitoring/connections
```

---

## Modelo de Datos

### Estados de Contactos en Test

```
PENDING    -> Contacto encolado, esperando procesamiento
CALLED     -> Worker inició la llamada
COMPLETED  -> Llamada finalizada exitosamente
FAILED     -> Llamada falló después de todos los reintentos
```

### Estructura de Jobs en Redis

**Job ID**: `{tipo}-{abTestContactId}-{timestamp}`

**Payload SDR**:
```json
{
  "contactId": "establishment-id",
  "abTestContactId": "uuid-contact",
  "agentConfigId": "uuid-config",
  "establishmentData": {
    "name": "Negocio X",
    "phone": "+526671234567",
    "address": "...",
    "employeeRange": "6 a 10 personas"
  },
  "enqueuedAt": "2026-02-20T21:00:00Z"
}
```

**Payload Qualification** (incluye decisionMakerData):
```json
{
  "contactId": "establishment-id",
  "abTestContactId": "uuid-contact",
  "agentConfigId": "uuid-config",
  "establishmentData": { ... },
  "decisionMakerData": {
    "name": "Juan Pérez",
    "email": "juan@negocio.com"
  },
  "enqueuedAt": "2026-02-20T21:00:00Z"
}
```

---

## Troubleshooting

### Workers no Procesan Trabajos

**Síntomas**: Jobs quedan en estado `waiting` indefinidamente, Bull Board muestra active=0

**Causas comunes**:
1. Workers no están corriendo
2. Redis desconectado
3. Error en configuración de agentes

**Solución**:
```bash
# 1. Verificar workers activos
ps aux | grep startWorkers
# Si no hay proceso: npm run start:workers

# 2. Verificar Redis
npm run redis:check
# Debe responder: Redis: PONG

# 3. Verificar logs de workers
# Buscar errores específicos
tail -f logs/combined.log | grep "Worker\|Error"

# 4. Verificar variables de entorno
echo $QUALIFICATION_AGENT_URL
echo $QUALIFICATION_API_KEY
```

### Jobs Marcados como Fallidos

**Síntomas**: Bull Board muestra jobs en pestaña "Failed"

**Investigar**:
```bash
# En Bull Board:
# 1. Click en job fallido
# 2. Ver "Stack Trace"
# 3. Revisar campo "failedReason"

# Errores comunes y soluciones:
```

**Error: "Request failed with status code 404"**
- Causa: URL de agente incorrecta o agente no disponible
- Solución: Verificar `SDR_AGENT_URL` o `QUALIFICATION_AGENT_URL`

**Error: "Timeout of 90000ms exceeded"**
- Causa: Agente no responde a tiempo
- Solución: Aumentar timeout en worker o verificar estado del agente

**Error: "Faltan datos requeridos: contactId, abTestContactId..."**
- Causa: Job mal formado al encolar
- Solución: Revisar código en `abTestsService.triggerTestCalls()`

### Concurrencia no se Respeta

**Síntomas**: Más de 3 llamadas SDR o más de 2 QUALIFICATION activas simultáneamente

**Verificar**:
```bash
# 1. Confirmar configuración de workers
grep "\.process(" src/workers/sdrCallWorker.js
# Debe mostrar: sdrCallQueue.process("sdr-call", 3, ...)

grep "\.process(" src/workers/qualificationCallWorker.js
# Debe mostrar: qualificationCallQueue.process("qualification-call", 2, ...)

# 2. Confirmar una sola instancia de worker por tipo
ps aux | grep startWorkers
# Debe haber solo 1 proceso

# 3. Reiniciar workers
pkill -f startWorkers
npm run start:workers
```

### Jobs Estancados (Stalled)

**Síntomas**: Logs muestran `[warn]: Job estancado (posible crash del worker)`

**Causa**: Worker crasheó mientras procesaba job, o job excedió `lockDuration`

**Solución automática**: Bull reintenta automáticamente jobs estancados

**Prevención**:
- Aumentar `lockDuration` en `src/queues/config.js` si llamadas son muy largas
- Asegurar que workers no crasheen (manejo de errores robusto)

### Formateo de Números de Teléfono

**Síntomas**: Llamadas fallan con error "Invalid phone number"

**Causa**: Número no tiene formato E.164 (+52XXXXXXXXXX)

**Solución**: Workers aplican formateo automático:
- Limpian espacios, guiones, paréntesis
- Agregan +52 si no existe
- Validación en `src/workers/qualificationCallWorker.js` línea 190-220

**Verificar en logs**:
```
[warn]: [Qualification Worker] Número con formato inesperado
  "original": "667 123 4567",
  "cleaned": "6671234567",
  "length": 10
```

### Memoria Elevada en Workers

**Síntomas**: Proceso worker consume >500MB RAM

**Causas**:
- Fuga de memoria por conexiones no cerradas
- Demasiados jobs en memoria

**Solución**:
```bash
# 1. Reiniciar workers
pkill -f startWorkers
npm run start:workers

# 2. Limitar jobs en memoria (config.js)
# Editar: maxStalledCount, lockDuration

# 3. Monitorear con top/htop
top -p $(pgrep -f startWorkers)
```

### SSE Streaming no Funciona

**Síntomas**: Frontend no recibe eventos de actualización

**Verificar**:
```bash
# 1. Probar endpoint directamente
curl -N http://localhost:3004/api/v1/ab-tests/{testId}/monitor-stream

# Debe mostrar:
# event: connected
# data: {"connectionId":"..."}
#
# event: update
# data: {"test":...}

# 2. Verificar conexiones activas
curl http://localhost:3004/api/v1/ab-tests/monitoring/connections

# 3. Ver logs de SSE
tail -f logs/combined.log | grep SSE
```

**Error común**: Controlador SSE declarado como `async`
- **Incorrecto**: `exports.streamGlobalQueueMonitoring = async (req, res) => {`
- **Correcto**: `exports.streamGlobalQueueMonitoring = (req, res) => {`

---

## Métricas y Rendimiento

### Capacidad Teórica

Con la configuración actual:

**Escenario óptimo** (llamadas de 60 segundos):
- SDR: 3 concurrentes x 60 llamadas/hora = 180 llamadas/hora
- Qualification: 2 concurrentes x 60 llamadas/hora = 120 llamadas/hora

**Escenario pesimista** (llamadas de 120 segundos):
- SDR: 3 concurrentes x 30 llamadas/hora = 90 llamadas/hora
- Qualification: 2 concurrentes x 30 llamadas/hora = 60 llamadas/hora

**Para 400 llamadas**:
- Tiempo estimado: 3-6 horas dependiendo de duración promedio
- Escalado: Desplegar múltiples instancias de workers en Railway

### Monitoreo de Salud

**Endpoints de salud**:
```bash
# Redis conectado
GET /api/health
# Response: { "status": "ok", "redis": "connected" }

# Estadísticas de colas
GET /api/v1/ab-tests/queue-stats
# Monitorear: waiting, active, failed

# Conexiones SSE
GET /api/v1/ab-tests/monitoring/connections
# Debe ser < 50 (límite configurado)
```

---

## Testing

### Tests de Integración

**Ejecutar**:
```bash
npm run test:integration
```

**Cobertura**:
- Test 1: Verificación de límites de concurrencia
- Test 2: Configuraciones de agentes disponibles
- Test 3: Creación de test y encolamiento
- Test 4: Progreso en tiempo real
- Test 5: Respeto de concurrencia bajo carga
- Test 6: Pausa y reanudación

**Salida exitosa**: `[COVERAGE] 100% de tests exitosos`

---

### Scripts Útiles

```bash
npm run dev                    # Iniciar API (desarrollo)
npm start                      # Iniciar API (producción)
npm run start:workers          # Iniciar workers
npm run test:integration       # Tests de integración
npm run test:integration:watch # Tests con auto-reload
npm run redis:check            # Verificar Redis
```

### Contactos de Prueba

IDs de establishments válidos para testing (base de datos real):
- 10552939 (PESCADOS Y MARISCOS FABIAN) - Tel: 6674044517
- 10032135 (VENTA DE CAPIROTADA) - Tel: 6672398415
- 10037858 (MARISCOS KEVIN)
- 10000456 (PAPAS ALMA)
- 8269692 (TAQUERIA EL SHOLO)
- 11183107 (ZEN SUSHI)
- 9546761 (AISPURO POLLOS)

---

## Mantenimiento

### Limpieza de Colas

**Cuando ejecutar**: Después de tests de desarrollo, antes de deploy

```bash
# Vía Bull Board
# 1. Acceder a http://localhost:3004/admin/queues
# 2. Seleccionar cola
# 3. Click en "Clean" -> "Completed" o "Failed"

# Vía API
curl -X POST http://localhost:3004/admin/queues/sdr-calls/clean
curl -X POST http://localhost:3004/admin/queues/qualification-calls/clean
```

### Actualización de Configuración

**Cambiar límites de concurrencia**:
1. Editar `src/workers/sdrCallWorker.js` o `qualificationCallWorker.js`
2. Modificar valor en `.process("queue-name", CONCURRENCY, ...)`
3. Reiniciar workers: `pkill -f startWorkers && npm run start:workers`

**Cambiar timeouts**:
1. Editar `src/queues/config.js`
2. Ajustar `lockDuration`, `stalledInterval`, etc.
3. Reiniciar workers

### Logs

**Ubicación**: `logs/combined.log`, `logs/error.log`

**Filtrar por componente**:
```bash
tail -f logs/combined.log | grep "SDR Worker"
tail -f logs/combined.log | grep "Qualification Worker"
tail -f logs/combined.log | grep "SSE"
```

**Buscar errores específicos**:
```bash
grep "Error\|Failed" logs/error.log | tail -20
```

---

## Escalado

### Escalado Vertical (Railway)

Aumentar recursos en Railway:
- CPU: 2 vCPUs recomendado para workers
- RAM: 1GB mínimo, 2GB recomendado
- Restart policy: Always

### Escalado Horizontal

**Opción 1**: Múltiples instancias de workers
```bash
# Railway: Escalar servicio partners-api-workers
# Settings -> Scaling -> Replicas: 2-3
```

**Opción 2**: Workers dedicados por tipo
- Servicio 1: Solo SDR workers
- Servicio 2: Solo Qualification workers
- Modificar `startWorkers.js` para iniciar solo uno

**Nota**: Todos los workers comparten la misma instancia de Redis.
