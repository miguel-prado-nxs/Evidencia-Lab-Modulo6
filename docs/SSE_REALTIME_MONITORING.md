# Sistema de Monitoreo en Tiempo Real - Implementación SSE

## Descripción General

Este documento describe la implementación de Server-Sent Events (SSE) para monitoreo en tiempo real de la ejecución de tests A/B y estadísticas de colas en easyorder-partners-api.

## Arquitectura

El sistema de monitoreo SSE consta de tres componentes principales:

1. **Capa de Servicio** (`src/services/abTestMonitoringService.js`)
   - Gestiona el ciclo de vida de las conexiones SSE
   - Agrega estadísticas de colas y progreso de tests
   - Maneja limpieza de conexiones y límites

2. **Capa de Controlador** (`src/controllers/abTestsController.js`)
   - Expone endpoints SSE
   - Valida solicitudes y existencia de tests
   - Delega streaming a la capa de servicio

3. **Rutas** (`src/routes/abTestsRoutes.js`)
   - Define rutas de endpoints
   - Mapea rutas HTTP a funciones del controlador

## Endpoints

### 1. Monitoreo Específico de Test

**Endpoint:** `GET /api/v1/ab-tests/:id/monitor-stream`

**Descripción:** Transmite progreso en tiempo real para un test A/B específico, incluyendo estadísticas de colas y métricas por variante.

**Parámetros:**
- `id` (parámetro de ruta): UUID del test A/B

**Tipo de Respuesta:** `text/event-stream`

**Tipos de Eventos:**

- **connected**
  ```json
  {
    "testId": "uuid",
    "connectionId": "test-uuid-timestamp",
    "timestamp": "2026-02-19T22:00:00.000Z"
  }
  ```

- **update** (cada 2 segundos)
  ```json
  {
    "timestamp": "2026-02-19T22:00:02.000Z",
    "testId": "uuid",
    "queues": {
      "sdr": {
        "waiting": 10,
        "active": 3,
        "completed": 45,
        "failed": 2,
        "delayed": 0
      },
      "qualification": {
        "waiting": 8,
        "active": 2,
        "completed": 30,
        "failed": 1,
        "delayed": 0
      },
      "total": {
        "waiting": 18,
        "active": 5,
        "completed": 75,
        "failed": 3,
        "delayed": 0
      }
    },
    "test": {
      "testId": "uuid",
      "testName": "Nombre del Test",
      "agentType": "SDR",
      "status": "RUNNING",
      "startDate": "2026-02-19T21:00:00.000Z",
      "variants": [
        {
          "variantId": "uuid",
          "variantName": "Variante A",
          "agentConfigId": "config-uuid",
          "voiceId": "voice-id",
          "percentage": 50,
          "totalAssigned": 100,
          "pending": 25,
          "called": 10,
          "completed": 60,
          "failed": 5,
          "totalProcessed": 75,
          "progressPercentage": 75,
          "successRate": 80
        }
      ],
      "overall": {
        "totalContacts": 200,
        "totalPending": 50,
        "totalProcessed": 150,
        "totalCompleted": 120,
        "totalFailed": 10,
        "overallProgress": 75
      }
    }
  }
  ```

- **complete**
  ```json
  {
    "testId": "uuid",
    "finalProgress": { /* misma estructura que el objeto test en update */ }
  }
  ```

- **error**
  ```json
  {
    "error": "Descripción del error",
    "testId": "uuid"
  }
  ```

**Ejemplo de Uso (JavaScript):**

```javascript
const eventSource = new EventSource('/api/v1/ab-tests/test-uuid/monitor-stream');

eventSource.addEventListener('connected', (event) => {
  const data = JSON.parse(event.data);
  console.log('Conectado:', data.connectionId);
});

eventSource.addEventListener('update', (event) => {
  const data = JSON.parse(event.data);
  
  // Actualizar UI con estadísticas de cola
  updateQueueStats(data.queues);
  
  // Actualizar progreso del test
  updateTestProgress(data.test);
});

eventSource.addEventListener('complete', (event) => {
  const data = JSON.parse(event.data);
  console.log('Test completado:', data.finalProgress);
  eventSource.close();
});

eventSource.addEventListener('error', (event) => {
  const data = JSON.parse(event.data);
  console.error('Error en stream:', data.error);
  eventSource.close();
});
```

### 2. Monitoreo Global de Colas

**Endpoint:** `GET /api/v1/ab-tests/queues/monitor-stream`

**Descripción:** Transmite estadísticas en tiempo real para todas las colas (SDR y Calificación) a través de todos los tests.

**Tipo de Respuesta:** `text/event-stream`

**Tipos de Eventos:**

- **connected**
  ```json
  {
    "scope": "global",
    "connectionId": "global-timestamp",
    "timestamp": "2026-02-19T22:00:00.000Z"
  }
  ```

- **update** (cada 2 segundos)
  ```json
  {
    "timestamp": "2026-02-19T22:00:02.000Z",
    "queues": {
      "sdr": { /* estadísticas de cola */ },
      "qualification": { /* estadísticas de cola */ },
      "total": { /* estadísticas agregadas */ }
    }
  }
  ```

**Ejemplo de Uso:**

```javascript
const eventSource = new EventSource('/api/v1/ab-tests/queues/monitor-stream');

eventSource.addEventListener('update', (event) => {
  const data = JSON.parse(event.data);
  console.log('Total de llamadas activas:', data.queues.total.active);
  console.log('Total pendientes:', data.queues.total.waiting);
});
```

### 3. Gestión de Conexiones

**Endpoint:** `GET /api/v1/ab-tests/monitoring/connections`

**Descripción:** Devuelve información sobre las conexiones SSE activas (para depuración y monitoreo).

**Respuesta:**

```json
{
  "success": true,
  "data": {
    "total": 3,
    "max": 50,
    "connections": [
      {
        "connectionId": "test-uuid-1737325200000",
        "testId": "test-uuid",
        "startedAt": "2026-02-19T22:00:00.000Z",
        "duration": 120
      }
    ]
  }
}
```

## Configuración

El sistema SSE puede configurarse en `src/services/abTestMonitoringService.js`:

```javascript
const SSE_UPDATE_INTERVAL_MS = 2000; // Frecuencia de actualización (2 segundos)
const SSE_KEEPALIVE_INTERVAL_MS = 30000; // Intervalo de ping keepalive (30 segundos)
const SSE_MAX_CONNECTIONS = 50; // Máximo de conexiones SSE concurrentes
```

## Detalles Técnicos

### Ciclo de Vida de la Conexión

1. **Conexión Establecida**
   - Cliente abre conexión SSE al endpoint
   - Servidor valida la solicitud (test existe, límite de conexiones no excedido)
   - Servidor envía evento `connected`
   - Conexión registrada en el Map `activeConnections`

2. **Fase de Streaming**
   - Servidor envía eventos `update` cada 2 segundos
   - Servidor envía comentarios keepalive cada 30 segundos (`: keepalive\n\n`)
   - Cliente recibe datos en tiempo real y actualiza UI

3. **Terminación de Conexión**
   - **Finalización normal:** Test termina, servidor envía evento `complete` y cierra conexión
   - **Desconexión del cliente:** Cliente cierra conexión, servidor detecta evento `close` y limpia
   - **Error:** Servidor encuentra error, envía evento `error` y cierra conexión
   - **Timeout:** Conexión automáticamente limpiada por Express/Node

### Gestión de Recursos

- **Límite de Conexiones:** Máximo 50 conexiones SSE concurrentes para prevenir agotamiento de recursos
- **Limpieza Automática:** Las conexiones se limpian automáticamente en:
  - Finalización del test
  - Desconexión del cliente
  - Condiciones de error
- **Eficiencia de Memoria:** Solo se almacenan metadatos de conexión activa (sin buffer de mensajes)

### Manejo de Concurrencia

Cada conexión SSE corre en su propio intervalo (no bloqueante):
- Intervalo de actualización consulta base de datos y estadísticas de cola cada 2 segundos
- Intervalo keepalive envía ping cada 30 segundos
- Todas las operaciones son asíncronas (async/await)

### Manejo de Errores

- **Test No Encontrado:** Devuelve evento `error` y cierra conexión
- **Errores de Base de Datos:** Registrados pero streaming continúa (envía evento error para esa actualización)
- **Límite de Conexiones:** Devuelve respuesta HTTP 503 Service Unavailable
- **Solicitud Inválida:** Manejada por middleware de Express y devuelve error HTTP apropiado

## Consideraciones de Rendimiento

### Carga de Base de Datos

Con 50 conexiones concurrentes e intervalo de actualización de 2 segundos:
- Tasa de consultas: ~25 consultas/segundo (por conexión: estadísticas de cola + progreso de test)
- Mitigación: 
  - Pooling de conexiones de Prisma
  - Considerar caché Redis para estadísticas de cola si es necesario
  - Consultas agregadas usan GROUP BY eficiente

### Ancho de Banda de Red

Cada evento de actualización es aproximadamente 1-2KB:
- 50 conexiones x 0.5 actualizaciones/seg = 25-50 KB/s
- Esto es insignificante para servidores modernos

### Uso de CPU

- Mínimo: SSE es basado en push, sin polling del cliente
- Serialización JSON es el principal consumidor de CPU (insignificante)

## Pruebas

### Pruebas Manuales con cURL

```bash
# Monitoreo específico de test
curl -N -H "Accept: text/event-stream" \
  http://localhost:3001/api/v1/ab-tests/TEST_UUID/monitor-stream

# Monitoreo global de colas
curl -N -H "Accept: text/event-stream" \
  http://localhost:3001/api/v1/ab-tests/queues/monitor-stream

# Verificar conexiones activas
curl http://localhost:3001/api/v1/ab-tests/monitoring/connections
```

### Pruebas Automatizadas

Ver `tests/sse-monitoring.test.js` para pruebas de integración (por implementar).

## Integración Frontend

### Ejemplo React

```jsx
import { useEffect, useState } from 'react';

function ABTestMonitor({ testId }) {
  const [progress, setProgress] = useState(null);
  const [queueStats, setQueueStats] = useState(null);

  useEffect(() => {
    const eventSource = new EventSource(
      `/api/v1/ab-tests/${testId}/monitor-stream`
    );

    eventSource.addEventListener('update', (event) => {
      const data = JSON.parse(event.data);
      setProgress(data.test);
      setQueueStats(data.queues);
    });

    eventSource.addEventListener('complete', () => {
      console.log('Test completado');
      eventSource.close();
    });

    return () => {
      eventSource.close();
    };
  }, [testId]);

  return (
    <div>
      <h2>Estadísticas de Cola</h2>
      <p>Llamadas Activas: {queueStats?.total.active}</p>
      <p>Pendientes: {queueStats?.total.waiting}</p>
      
      <h2>Progreso del Test</h2>
      <p>General: {progress?.overall.overallProgress}%</p>
      {progress?.variants.map(v => (
        <div key={v.variantId}>
          <h3>{v.variantName}</h3>
          <p>Progreso: {v.progressPercentage}%</p>
          <p>Tasa de Éxito: {v.successRate}%</p>
        </div>
      ))}
    </div>
  );
}
```

## Solución de Problemas

### La Conexión No Recibe Actualizaciones

1. Revisar logs del servidor para errores
2. Verificar que el ID del test es válido
3. Asegurarse que el cliente escucha los tipos de eventos correctos
4. Revisar pestaña Network del DevTools del navegador para estado de conexión SSE

### Límite de Conexiones Alcanzado

1. Verificar conexiones activas: `GET /api/v1/ab-tests/monitoring/connections`
2. Identificar conexiones obsoletas
3. Esperar limpieza automática o reiniciar workers
4. Considerar aumentar `SSE_MAX_CONNECTIONS` si es necesario

### Alta Carga de Base de Datos

1. Monitorear logs de consultas de Prisma
2. Verificar número de conexiones SSE activas
3. Considerar implementar caché Redis para estadísticas de cola
4. Aumentar intervalo de actualización si precisión en tiempo real no es crítica

## Consideraciones de Seguridad

### Autenticación

Actualmente, los endpoints SSE no están autenticados. **TODO:** Agregar middleware de autenticación:

```javascript
// En routes/abTestsRoutes.js
const { authenticateToken } = require('../middleware/auth');

router.get('/:id/monitor-stream', authenticateToken, abTestsController.streamTestMonitoring);
```

### Autorización

Verificar que el usuario tiene acceso al test específico antes de transmitir datos.

### Rate Limiting

Considerar agregar rate limiting para prevenir abuso:

```javascript
const rateLimit = require('express-rate-limit');

const sseRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10 // limitar cada IP a 10 conexiones SSE por ventana
});

router.get('/:id/monitor-stream', sseRateLimiter, abTestsController.streamTestMonitoring);
```

## Cumplimiento de Requisitos

De CRM-657.csv Historia "Monitoreo y Streaming en Tiempo Real":

- [x] Endpoint SSE implementado
- [x] Actualizaciones cada 2 segundos
- [x] Cierra la conexión correctamente
- [x] Monitoreo específico de test y global
- [x] Limpieza automática en desconexión
- [x] Gestión de límite de conexiones
- [x] Manejo robusto de errores

## Mejoras Futuras

1. **Soporte WebSocket:** Considerar WebSocket para comunicación bidireccional (pausar/reanudar tests desde dashboard en tiempo real)
2. **Redis Pub/Sub:** Usar Redis para distribuir actualizaciones a través de múltiples instancias de servidor
3. **Datos Históricos:** Incluir tendencias históricas en actualizaciones (llamadas por minuto, tasa de éxito a lo largo del tiempo)
4. **Alertas:** Enviar alertas críticas vía SSE (alta tasa de fallos, congestión de colas)
5. **Filtrado:** Permitir que clientes se suscriban solo a variantes o métricas específicas
6. **Compresión:** Gzip datos SSE para payloads más grandes

## Documentación Relacionada

- [PLAN_SISTEMA_COLAS_AB_TESTING.md](PLAN_SISTEMA_COLAS_AB_TESTING.md) - Arquitectura general del sistema de colas
- [CRM-657.csv](CRM-657.csv) - Requisitos del epic y historia
- [Documentación Bull Queue](https://docs.bullmq.io/) - Documentación del sistema de colas
