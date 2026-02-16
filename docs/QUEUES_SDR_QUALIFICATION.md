# Implementación de Queues SDR y Qualification

Documentación técnica de la historia "Implementación de Queues SDR y Qualification", parte de la épica **Implementación de Sistema de Colas para A/B Testing Escalable (+400 llamadas)**.

---

## Contexto

Esta historia extiende la infraestructura base de Redis + Bull implementada previamente, agregando las funciones de encolamiento que permiten añadir trabajos a las colas SDR y Qualification de forma programática.

---

## Funciones de encolamiento implementadas

### `enqueueSDRCall(jobData, options)`

Encola una llamada SDR para procesamiento asíncrono.

**Parámetros:**

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `jobData.contactId` | string | Sí | ID del contacto (establishment enrichment) |
| `jobData.abTestContactId` | string | Sí | ID del registro en abTestContact |
| `jobData.agentConfigId` | string | Sí | ID de la configuración del agente |
| `jobData.establishmentData` | object | No | Datos del establecimiento para la llamada |
| `options.priority` | number | No | Prioridad del job (menor = mayor prioridad) |
| `options.delay` | number | No | Retraso en ms antes de procesar |

**Retorna:** Promise<Job> - Job encolado con id y metadata.

**Ejemplo de uso:**

```javascript
const { enqueueSDRCall } = require('./queues');

const jobData = {
  contactId: "enrichment-123",
  abTestContactId: "ab-contact-456",
  agentConfigId: "agent-config-789",
  establishmentData: {
    name: "Restaurante El Buen Sabor",
    phone: "5551234567",
    address: "Av. Insurgentes 123, CDMX",
  },
};

const job = await enqueueSDRCall(jobData);
console.log('Job encolado:', job.id);
```

**ID del Job generado:** `sdr-{abTestContactId}-{timestamp}`

---

### `enqueueQualificationCall(jobData, options)`

Encola una llamada de Calificación para procesamiento asíncrono.

**Parámetros:**

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `jobData.contactId` | string | Sí | ID del contacto (establishment enrichment) |
| `jobData.abTestContactId` | string | Sí | ID del registro en abTestContact |
| `jobData.agentConfigId` | string | Sí | ID de la configuración del agente |
| `jobData.establishmentData` | object | No | Datos del establecimiento para la llamada |
| `jobData.decisionMakerData` | object | No | Datos del tomador de decisiones |
| `options.priority` | number | No | Prioridad del job (menor = mayor prioridad) |
| `options.delay` | number | No | Retraso en ms antes de procesar |

**Retorna:** Promise<Job> - Job encolado con id y metadata.

**Ejemplo de uso:**

```javascript
const { enqueueQualificationCall } = require('./queues');

const jobData = {
  contactId: "enrichment-456",
  abTestContactId: "ab-contact-789",
  agentConfigId: "agent-config-012",
  establishmentData: {
    name: "Restaurante La Cocina",
    phone: "5559876543",
    address: "Calle Reforma 456, CDMX",
  },
  decisionMakerData: {
    name: "María González",
    position: "Gerente General",
  },
};

const job = await enqueueQualificationCall(jobData);
console.log('Job encolado:', job.id);
```

**ID del Job generado:** `qualification-{abTestContactId}-{timestamp}`

---

## Validaciones

Ambas funciones validan que los campos requeridos estén presentes:

- `contactId`: ID del contacto a llamar
- `abTestContactId`: ID del registro de seguimiento
- `agentConfigId`: ID de la configuración del agente a usar

Si falta alguno de estos campos, se lanza un error:

```
Error: Faltan datos requeridos: contactId, abTestContactId, agentConfigId
```

---

## Metadatos del Job

Cada job encolado incluye:

```javascript
{
  contactId: "...",
  abTestContactId: "...",
  agentConfigId: "...",
  establishmentData: {...},
  decisionMakerData: {...},  // Solo Qualification
  enqueuedAt: "2026-02-13T23:47:40.774Z"
}
```

El campo `enqueuedAt` registra el timestamp exacto de encolamiento para métricas y auditoría.

---

## Opciones de encolamiento

### Prioridad

Los jobs pueden encolarse con diferente prioridad. Jobs con menor valor numérico se procesan primero:

```javascript
// Alta prioridad (procesa primero)
await enqueueSDRCall(jobData, { priority: 1 });

// Prioridad normal
await enqueueSDRCall(jobData);

// Baja prioridad (procesa después)
await enqueueSDRCall(jobData, { priority: 10 });
```

### Delay (retraso)

Los jobs pueden ser encolados con un delay para ejecutarse en el futuro:

```javascript
// Ejecutar en 5 minutos
await enqueueSDRCall(jobData, { delay: 5 * 60 * 1000 });

// Ejecutar inmediatamente
await enqueueSDRCall(jobData);
```

---

## Logging

Las funciones de encolamiento registran eventos con Winston:

**Al encolar un job:**
```
[info]: [SDR Queue] Job encolado {"jobId":"sdr-...", "contactId":"...", "abTestContactId":"..."}
```

**Al procesar (eventos de la cola):**
```
[debug]: [SDR Queue] Job en espera {"jobId":"..."}
[info]: [SDR Queue] Procesando job {"jobId":"...", "contactId":"..."}
[info]: [SDR Queue] Job completado {"jobId":"...", "status":"..."}
```

**En caso de error:**
```
[error]: [SDR Queue] Job fallido {"jobId":"...", "error":"...", "attemptsMade":3}
```

---

## Pruebas

### Script de prueba

Se incluye un script de prueba para validar el encolamiento:

```bash
npm run test:enqueue
```

Este script:
1. Encola un job SDR de prueba
2. Encola un job Qualification de prueba
3. Obtiene y muestra estadísticas de ambas colas
4. Confirma que los jobs están esperando procesamiento

**Salida esperada:**

```
[Test] Iniciando prueba de encolamiento...

[Test] Encolando job SDR...
[Test] Job SDR encolado exitosamente: { id: 'sdr-...', name: 'sdr-call' }

[Test] Encolando job Qualification...
[Test] Job Qualification encolado exitosamente: { id: 'qualification-...', name: 'qualification-call' }

[SDR Queue Stats]: { waiting: 1, active: 0, completed: 0, failed: 0, total: 1 }
[Qualification Queue Stats]: { waiting: 1, active: 0, completed: 0, failed: 0, total: 1 }

[Test] Prueba completada exitosamente
```

---

## Integración con el sistema

Las funciones de encolamiento se exportan desde el módulo centralizado:

```javascript
const {
  enqueueSDRCall,
  enqueueQualificationCall,
  getSDRQueueStats,
  getQualificationQueueStats,
} = require('./queues');
```

O desde archivos individuales:

```javascript
const { enqueueSDRCall } = require('./queues/sdrCallQueue');
const { enqueueQualificationCall } = require('./queues/qualificationCallQueue');
```

---

## Próximos pasos

Los jobs encolados permanecerán en estado `waiting` hasta que se implementen los workers de procesamiento (historia siguiente: "Implementación de Workers de Procesamiento").

Los workers:
- Procesarán los jobs respetando límites de concurrencia (SDR: 3, Qualification: 2)
- Llamarán a los agentes de voz correspondientes
- Actualizarán el estado en `abTestContact`
- Manejarán reintentos automáticos en caso de fallo

---

## Estado de la historia

**Status:** Completada

### Criterios de aceptación cumplidos

- ✓ Queue SDR creada
- ✓ Queue Qualification creada
- ✓ Métodos enqueue funcionales
- ✓ Métodos de estadísticas implementados

### Archivos modificados

| Archivo | Cambio |
|---------|--------|
| [src/queues/sdrCallQueue.js](../src/queues/sdrCallQueue.js) | Agregada función `enqueueSDRCall` |
| [src/queues/qualificationCallQueue.js](../src/queues/qualificationCallQueue.js) | Agregada función `enqueueQualificationCall` |
| [src/queues/index.js](../src/queues/index.js) | Exportadas funciones de encolamiento |
| [scripts/checkRedis.js](../scripts/checkRedis.js) | Script de verificación de Redis (refactor) |
| [package.json](../package.json) | Agregado script `test:enqueue` |

### Archivos creados

| Archivo | Propósito |
|---------|-----------|
| [src/queues/testEnqueue.js](../src/queues/testEnqueue.js) | Script de prueba de encolamiento |

---

## Referencias

- [Documentación de Redis y Bull](REDIS_BULL_CONFIGURATION.md)
- [Plan de implementación completo](../PLAN_SISTEMA_COLAS_AB_TESTING.md)
- [Bull Queue Documentation](https://github.com/OptimalBits/bull)
