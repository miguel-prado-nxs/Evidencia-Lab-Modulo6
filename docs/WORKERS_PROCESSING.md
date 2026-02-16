# Implementación de Workers de Procesamiento

Documentación técnica de la historia "Implementación de Workers de Procesamiento", parte de la épica **Implementación de Sistema de Colas para A/B Testing Escalable (+400 llamadas)**.

---

## Contexto

Esta historia implementa los workers que procesan los trabajos encolados en las colas SDR y Qualification. Los workers ejecutan las llamadas a los agentes de voz respetando límites de concurrencia para evitar saturación y mantener la calidad de las conversaciones.

---

## Arquitectura de Workers

### SDR Call Worker

**Archivo:** [src/workers/sdrCallWorker.js](../src/workers/sdrCallWorker.js)

**Concurrencia:** 3 llamadas simultáneas

**Responsabilidades:**
- Procesar jobs de la cola "sdr-calls"
- Ejecutar llamadas al agente SDR
- Actualizar estado de contactos en BD (abTestContact)
- Manejar reintentos automáticos en caso de fallo
- Implementar delay de 3 segundos entre llamadas

### Qualification Call Worker

**Archivo:** [src/workers/qualificationCallWorker.js](../src/workers/qualificationCallWorker.js)

**Concurrencia:** 2 llamadas simultáneas

**Responsabilidades:**
- Procesar jobs de la cola "qualification-calls"
- Ejecutar llamadas al agente de Calificación
- Actualizar estado de contactos en BD (abTestContact)
- Manejar reintentos automáticos en caso de fallo
- Implementar delay de 3 segundos entre llamadas

---

## Flujo de Procesamiento

### 1. Obtención de Job

El worker obtiene un job de la cola automáticamente cuando:
- Hay jobs en estado `waiting`
- La concurrencia actual es menor al límite configurado

### 2. Actualización a CALLED

Antes de ejecutar la llamada, se actualiza el estado del contacto:

```javascript
await prisma.abTestContact.update({
  where: { id: abTestContactId },
  data: {
    status: "CALLED",
    calledAt: new Date()
  }
});
```

### 3. Ejecución de Llamada

El worker realiza una petición HTTP POST al agente correspondiente:

**SDR Agent:**
```javascript
POST {SDR_AGENT_URL}/api/call
Headers: Authorization: Bearer {SDR_API_KEY}
Body: {
  contactId,
  agentConfigId,
  establishmentData,
  metadata: {
    abTestContactId,
    source: "ab-testing"
  }
}
Timeout: 60 segundos
```

**Qualification Agent:**
```javascript
POST {QUALIFICATION_AGENT_URL}/api/call
Headers: Authorization: Bearer {QUALIFICATION_API_KEY}
Body: {
  contactId,
  agentConfigId,
  establishmentData,
  decisionMakerData,
  metadata: {
    abTestContactId,
    source: "ab-testing"
  }
}
Timeout: 90 segundos
```

### 4. Procesamiento de Respuesta

**Respuesta exitosa:**
```javascript
{
  status: "completed",
  callId: "call-abc-123",
  duration: 180,
  outcome: "interested",
  qualificationScore: 8.5  // Solo Qualification
}
```

Se registra en BD:
```javascript
await prisma.abTestContact.update({
  where: { id: abTestContactId },
  data: {
    status: "COMPLETED",
    result: JSON.stringify({
      success: true,
      status: "completed",
      callId: "call-abc-123",
      duration: 180,
      outcome: "interested",
      timestamp: "2026-02-16T10:30:00.000Z"
    })
  }
});
```

**Respuesta con error:**
```javascript
// Error capturado (timeout, red, rechazo del agente, etc.)
await prisma.abTestContact.update({
  where: { id: abTestContactId },
  data: {
    status: "FAILED",
    result: JSON.stringify({
      success: false,
      error: "Connection timeout",
      errorCode: 504,
      timestamp: "2026-02-16T10:30:00.000Z"
    })
  }
});
```

Bull reintentará automáticamente el job según la configuración (3 intentos por defecto).

### 5. Delay entre llamadas

Después de completar cada llamada, el worker espera 3 segundos antes de procesar el siguiente job:

```javascript
await delay(3000);
```

Esto previene saturación del agente y mejora la calidad de las conversaciones.

---

## Configuración

### Variables de Entorno

**Agente SDR:**
```env
SDR_AGENT_URL=https://testing-fabian-ai-voice-agent-prospecto-dev.up.railway.app
SDR_API_KEY=sdr_9888e39e8394a2bce8ae5d317995bbd7ce41adce6560f849
```

**Agente Calificación:**
```env
QUALIFICATION_AGENT_URL=https://testing-qualification-agent.up.railway.app
QUALIFICATION_API_KEY=qual_key_placeholder
```

### Configuración en env.js

```javascript
// src/config/env.js
agents: {
  sdr: {
    url: process.env.SDR_AGENT_URL || "http://localhost:8080",
    apiKey: process.env.SDR_API_KEY || "",
  },
  qualification: {
    url: process.env.QUALIFICATION_AGENT_URL || "http://localhost:8081",
    apiKey: process.env.QUALIFICATION_API_KEY || "",
  },
}
```

---

## Ejecución de Workers

### Desarrollo Local

**Opción 1: Iniciar todos los workers**
```bash
npm run start:workers
```

**Opción 2: Iniciar worker individual (para debugging)**
```bash
node src/workers/sdrCallWorker.js
node src/workers/qualificationCallWorker.js
```

### Producción (Railway)

Los workers se despliegan como un proceso separado del servidor HTTP:

**Servicio:** `partners-api-workers`

**Comando de inicio:** `npm run start:workers`

**Variables de entorno:** Mismas que el servidor HTTP + Redis URL

---

## Actualización de Estados

Los workers actualizan el modelo `AbTestContact` en Prisma:

```prisma
model AbTestContact {
  id              String   @id @default(uuid())
  abTestVariantId String
  contactId       String
  contactType     String   @default("ESTABLISHMENT")
  
  status          String   @default("PENDING")
  // PENDING -> CALLED -> COMPLETED/FAILED
  
  result          String?  // JSON stringificado
  calledAt        DateTime?
  createdAt       DateTime @default(now())
}
```

**Transiciones de estado:**
- `PENDING`: Job encolado pero no procesado
- `CALLED`: Worker inició la llamada
- `COMPLETED`: Llamada exitosa
- `FAILED`: Llamada falló después de todos los reintentos

---

## Logging

Los workers registran eventos con Winston en formato JSON:

**Inicio del worker:**
```
[info]: [SDR Worker] Iniciado con concurrencia de 3 llamadas
```

**Procesamiento de job:**
```
[info]: [SDR Worker] Procesando job {
  "jobId": "sdr-ab-contact-123-1771026460746",
  "abTestContactId": "ab-contact-123",
  "attemptsMade": 0
}
```

**Llamada iniciada:**
```
[info]: [SDR Worker] Iniciando llamada SDR {
  "abTestContactId": "ab-contact-123",
  "contactId": "enrichment-456",
  "agentConfigId": "config-789"
}
```

**Llamada completada:**
```
[info]: [SDR Worker] Llamada completada exitosamente {
  "abTestContactId": "ab-contact-123",
  "callId": "call-abc-123"
}
```

**Job completado:**
```
[info]: [SDR Worker] Job completado {
  "jobId": "sdr-ab-contact-123-1771026460746",
  "abTestContactId": "ab-contact-123",
  "success": true
}
```

**Error en llamada:**
```
[error]: [SDR Worker] Error en llamada SDR {
  "abTestContactId": "ab-contact-123",
  "error": "Request timeout",
  "response": {...}
}
```

**Job fallido (definitivo):**
```
[error]: [SDR Worker] Job falló definitivamente después de todos los reintentos {
  "jobId": "sdr-ab-contact-123-1771026460746",
  "abTestContactId": "ab-contact-123"
}
```

---

## Manejo de Errores y Reintentos

### Configuración de Reintentos

Los reintentos están configurados en Bull (src/queues/config.js):

```javascript
defaultJobOptions: {
  attempts: 3,                    // 3 intentos totales
  backoff: {
    type: "exponential",          // Backoff exponencial
    delay: 5000,                  // Delay inicial: 5 segundos
  },
  removeOnComplete: 100,          // Retener últimos 100 jobs completados
  removeOnFail: 200,              // Retener últimos 200 jobs fallidos
}
```

**Secuencia de reintentos:**
1. Intento 1: Falla → Espera 5 segundos
2. Intento 2: Falla → Espera 10 segundos
3. Intento 3: Falla → Marca como FAILED definitivamente

### Tipos de Errores

**Errores reintentables (Bull reintenta automáticamente):**
- Timeout de red
- Error 5xx del agente
- Conexión rechazada

**Errores no reintentables (el worker marca como FAILED):**
- Datos faltantes en el job
- Error 4xx del agente (datos inválidos)

---

## Pruebas

### Script de Prueba

```bash
npm run test:workers
```

Este script:
1. Encola jobs de prueba SDR y Qualification
2. Monitorea el progreso cada 5 segundos durante 2 minutos
3. Verifica que los workers procesen los jobs correctamente

**IMPORTANTE:** Los workers deben estar corriendo en otro proceso:
```bash
# Terminal 1: Iniciar workers
npm run start:workers

# Terminal 2: Ejecutar test
npm run test:workers
```

**Salida esperada:**

```
[info]: [Test Workers] Iniciando prueba de workers...
[info]: [Test Workers] Encolando trabajos de prueba...
[info]: [Test Workers] Job SDR encolado { "jobId": "sdr-..." }
[info]: [Test Workers] Job Calificación encolado { "jobId": "qualification-..." }
[info]: [Test Workers] Monitoreando progreso de los jobs...
[info]: [Test Workers] Iteración 1/24 {
  "sdr": { "waiting": 1, "active": 0, "completed": 0, "failed": 0 },
  "qualification": { "waiting": 1, "active": 0, "completed": 0, "failed": 0 }
}
[info]: [Test Workers] Iteración 2/24 {
  "sdr": { "waiting": 0, "active": 1, "completed": 0, "failed": 0 },
  "qualification": { "waiting": 0, "active": 1, "completed": 0, "failed": 0 }
}
[info]: [Test Workers] Job SDR completado exitosamente
[info]: [Test Workers] Job Calificación completado exitosamente
[info]: [Test Workers] PRUEBA EXITOSA: Todos los workers funcionan correctamente
```

### Prueba Manual

1. Verificar que Redis está corriendo:
```bash
npm run redis:check
```

2. Iniciar workers en modo desarrollo:
```bash
npm run start:workers
```

3. En otro terminal, encolar un job de prueba:
```bash
npm run test:enqueue
```

4. Verificar logs del worker - debería procesar el job

5. Verificar en Bull Board (http://localhost:3004/admin/queues):
   - Jobs en estado `completed`
   - Métricas de procesamiento
   - Tiempos de ejecución

---

## Monitoreo

### Bull Board

Acceder a: `http://localhost:3004/admin/queues`

**Métricas disponibles:**
- Jobs waiting (esperando)
- Jobs active (en proceso)
- Jobs completed (completados)
- Jobs failed (fallidos)
- Jobs delayed (retrasados)

**Acciones disponibles:**
- Ver detalles de jobs
- Reintentar jobs fallidos manualmente
- Limpiar colas
- Ver logs de jobs individuales

### Logs de Workers

Los workers loggean usando Winston con formato JSON, lo que permite:
- Búsqueda por abTestContactId
- Filtrado por nivel (info, error, warn)
- Análisis de tiempos de ejecución
- Identificación de patrones de fallo

**Ejemplo de búsqueda en Railway:**
```
[SDR Worker] abTestContactId:ab-contact-123
```

---

## Troubleshooting

### Jobs marcados como "stalled" (estancados)

**Síntoma:** Advertencias `[Worker] Job estancado (posible crash)` en los logs

**Causa:** Bull marca un job como "stalled" cuando:
- El worker se crasheó mientras procesaba el job
- El job tarda más que el `lockDuration` configurado (5 minutos por defecto)
- Hay problemas de red/timeout con los agentes externos

**Configuración actual:**
- `lockDuration`: 5 minutos (300,000 ms)
- `stalledInterval`: 30 segundos (verificación cada 30s)
- `maxStalledCount`: 2 comprobaciones antes de marcar como estancado

**Solución:**
- Bull reintenta automáticamente los jobs estancados
- Si los agentes no están disponibles (desarrollo), estos errores son esperados
- En producción, verificar que los agentes SDR/Qualification estén activos
- Revisar logs del worker para identificar la causa del crash

**Desarrollo sin agentes activos:**

Si ejecutas los workers sin tener los agentes SDR/Qualification activos:
- Los jobs fallarán con error 404 (esperado)
- Bull reintentará 3 veces con backoff exponencial
- Después de todos los reintentos, el job se marcará como FAILED
- Esto es normal y no indica un problema con el sistema de colas

Para pruebas locales completas, necesitas:
1. Agentes SDR y Qualification corriendo localmente
2. O usar mocks/stubs para simular las respuestas

### Workers no procesan jobs

**Síntoma:** Jobs permanecen en estado `waiting`

**Verificar:**
1. Workers están corriendo: `ps aux | grep startWorkers`
2. Redis está accesible: `npm run redis:check`
3. Variables de entorno configuradas correctamente
4. Logs del worker: buscar errores de conexión

**Solución:**
```bash
# Reiniciar workers
pkill -f startWorkers
npm run start:workers
```

### Jobs fallando constantemente

**Síntoma:** Alta tasa de jobs en estado `failed`

**Verificar:**
1. Agentes SDR/Qualification están activos
2. URLs y API Keys correctos en .env
3. Logs del worker: ver detalles del error
4. Timeout suficiente (60s SDR, 90s Qualification)

**Solución:**
- Verificar conectividad con agentes
- Aumentar timeout si es necesario
- Revisar formato de datos en el job

### Jobs estancados (stalled)

**Síntoma:** Jobs marcados como `stalled` en Bull Board

**Causa:** El worker se crasheó mientras procesaba el job

**Verificar:**
1. Logs del worker: buscar excepciones
2. Memoria disponible en el contenedor
3. Errores de Prisma (conexión DB)

**Solución:**
- Reiniciar workers
- Bull reintentará automáticamente los jobs estancados
- Investigar causa del crash en logs

### Concurrencia no respetada

**Síntoma:** Más de 3 llamadas SDR simultáneas (o más de 2 Qualification)

**Verificar:**
1. Solo una instancia del worker corriendo
2. Parámetro de concurrencia en `queue.process()` correcto

**Solución:**
- Verificar en Railway que solo hay 1 instancia del servicio workers
- Revisar código del worker: debe ser `queue.process('type', 3, async (job) => ...)`

---

## Estado de la Historia

**Status:** Completada

### Criterios de Aceptación Cumplidos

- ✓ Worker SDR ejecuta llamadas correctamente
- ✓ Worker Qualification ejecuta llamadas correctamente
- ✓ Estados actualizados en Prisma (PENDING → CALLED → COMPLETED/FAILED)
- ✓ Reintentos configurados (3 intentos, backoff exponencial)
- ✓ Concurrencia respetada (SDR: 3, Qualification: 2)
- ✓ Delay de 3 segundos entre llamadas implementado

### Archivos Creados

| Archivo | Propósito |
|---------|-----------|
| [src/workers/sdrCallWorker.js](../src/workers/sdrCallWorker.js) | Worker de procesamiento SDR |
| [src/workers/qualificationCallWorker.js](../src/workers/qualificationCallWorker.js) | Worker de procesamiento Qualification |
| [src/startWorkers.js](../src/startWorkers.js) | Punto de entrada para iniciar workers |
| [src/queues/testWorkers.js](../src/queues/testWorkers.js) | Script de prueba de workers |

### Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| [src/config/env.js](../src/config/env.js) | Agregada configuración de agentes |
| [.env](../.env) | Agregadas URLs y API keys de agentes |
| [package.json](../package.json) | Agregados scripts `start:workers` y `test:workers` |

---

## Próximos Pasos

La siguiente historia es: **Integración con A/B Testing**

Esta historia incluye:
- Crear servicio de encolamiento (queueService.js)
- Modificar abTestsService para usar queues en lugar de loop síncrono
- Actualizar controlador con endpoints de monitoreo (/queue-stats, /pause, /resume)

---

## Referencias

- [Documentación de Queues SDR y Qualification](QUEUES_SDR_QUALIFICATION.md)
- [Documentación de Redis y Bull](REDIS_BULL_CONFIGURATION.md)
- [Plan de implementación completo](../PLAN_SISTEMA_COLAS_AB_TESTING.md)
- [Bull Queue Documentation](https://github.com/OptimalBits/bull)
- [Prisma Client Documentation](https://www.prisma.io/docs/concepts/components/prisma-client)
