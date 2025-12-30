# Sistema de Actualización en Tiempo Real para EasyOrder Leads

## Descripción General

Este documento describe la implementación de un sistema de **Server-Sent Events (SSE)** que permite sincronizar automáticamente el frontend de ventas cuando el agente de enriquecimiento (Python) actualiza datos de establecimientos.

## Problema Resuelto

Anteriormente, cuando el agente de Python enriquecía un establecimiento (cambiándolo de CONTACT a PROSPECT, o de PROSPECT a LEAD), el frontend no se enteraba del cambio. Los usuarios tenían que refrescar manualmente la página para ver las actualizaciones.

## Solución Implementada

Se implementó **Server-Sent Events (SSE)** por las siguientes razones:

| Característica | SSE | WebSockets | Polling |
|---------------|-----|------------|---------|
| Conexión | Unidireccional (servidor→cliente) | Bidireccional | N/A |
| Overhead | Bajo | Medio | Alto |
| Reconexión automática | Sí (nativo) | Manual | N/A |
| Complejidad | Baja | Media | Baja |
| Carga del servidor | Baja | Media | Alta |

SSE es ideal para este caso porque solo necesitamos enviar eventos del servidor al cliente, no viceversa.

---

## Arquitectura

```
┌─────────────────────┐
│   Agente Python     │
│   (SDR/Enrichment)  │
└─────────┬───────────┘
          │ POST /api/v1/geo/enrichment/:id
          │ PATCH /api/v1/qualification/call-result
          ▼
┌─────────────────────────────────────────────────────┐
│              easyorder-partners-api                 │
│  ┌─────────────────────────────────────────────┐   │
│  │         enrichmentService.js                 │   │
│  │  - createOrUpdateEnrichment()               │   │
│  │  - Detecta cambio de nivel                  │   │
│  │  - Llama a emitLevelChanged()               │   │
│  └─────────────────┬───────────────────────────┘   │
│                    │                                │
│  ┌─────────────────▼───────────────────────────┐   │
│  │           sseEvents.js                       │   │
│  │  - Mantiene mapa de clientes conectados     │   │
│  │  - emitLevelChanged(partnerId, data)        │   │
│  │  - emitEnrichmentUpdated(partnerId, data)   │   │
│  └─────────────────┬───────────────────────────┘   │
│                    │                                │
│  ┌─────────────────▼───────────────────────────┐   │
│  │         routes/events.js                     │   │
│  │  GET /api/v1/events/enrichments             │   │
│  │  - Conexión SSE persistente                 │   │
│  │  - Heartbeat cada 30s                       │   │
│  └─────────────────┬───────────────────────────┘   │
└────────────────────┼────────────────────────────────┘
                     │ SSE Stream
                     ▼
┌─────────────────────────────────────────────────────┐
│              easyorder-leads (Frontend)             │
│  ┌─────────────────────────────────────────────┐   │
│  │     hooks/useEnrichmentEvents.ts             │   │
│  │  - EventSource connection                   │   │
│  │  - Auto-reconnect on error                  │   │
│  │  - Callbacks: onLevelChanged, onUpdated     │   │
│  └─────────────────┬───────────────────────────┘   │
│                    │                                │
│  ┌─────────────────▼───────────────────────────┐   │
│  │      app/mis-negocios/page.tsx               │   │
│  │  - Usa useEnrichmentEvents hook             │   │
│  │  - Refresca tabla automáticamente           │   │
│  │  - Actualiza contadores de niveles          │   │
│  │  - Muestra toast de notificación            │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

---

## Archivos Modificados/Creados

### Backend (easyorder-partners-api)

#### 1. `src/config/sseEvents.js` (NUEVO)

Servicio centralizado para manejar eventos SSE.

```javascript
// Funciones principales:
- registerClient(partnerId, res)      // Registra cliente SSE
- unregisterClient(partnerId, res)    // Desregistra cliente
- emitLevelChanged(params)            // Emite evento de cambio de nivel
- emitEnrichmentUpdated(params)       // Emite evento de actualización
- sendToPartner(partnerId, event, data) // Envía evento a un partner
- formatSSEMessage(event, data)       // Formatea mensaje SSE
- getStats()                          // Estadísticas de conexiones
```

**Estructura de eventos emitidos:**
```javascript
// enrichment:level-changed
{
  establishmentId: "uuid-123",
  previousLevel: "PROSPECT",
  newLevel: "LEAD",
  enrichment: {
    id: "enrich-uuid",
    level: "LEAD",
    decisionMakerName: "Juan Pérez",
    updatedAt: "2024-12-29T..."
  },
  timestamp: "2024-12-29T..."
}

// enrichment:updated
{
  establishmentId: "uuid-123",
  previousLevel: "PROSPECT",
  newLevel: "PROSPECT", // mismo nivel
  enrichment: { ... },
  timestamp: "2024-12-29T..."
}
```

#### 2. `src/routes/events.js` (NUEVO)

Endpoint para conexiones SSE.

```javascript
GET /api/v1/events/enrichments

// Query params (requeridos para SSE ya que no soporta headers):
- serviceKey: Clave de autenticación
- salesUserId: ID del usuario de ventas
- salesUserName: Nombre del usuario
- salesUserEmail: Email del usuario
- salesUserRole: Rol del usuario

// Eventos enviados al cliente:
- connected: Conexión establecida
- heartbeat: Keep-alive cada 30 segundos
- enrichment:level-changed: Cambio de nivel detectado
- enrichment:updated: Datos actualizados sin cambio de nivel
```

#### 3. `src/services/enrichmentService.js` (MODIFICADO)

Se agregó la emisión de eventos SSE en `createOrUpdateEnrichment()`:

```javascript
// Importación del módulo SSE
const { emitLevelChanged, emitEnrichmentUpdated } = require("../config/sseEvents");

// En createOrUpdateEnrichment():
// - Guarda el nivel anterior antes de actualizar
// - Después de guardar, compara niveles
// - Si cambió: emitLevelChanged()
// - Si no cambió: emitEnrichmentUpdated()
```

#### 4. `src/controllers/qualificationController.js` (MODIFICADO)

Se agregó emisión de eventos cuando el agente de calificación promueve a LEAD:

```javascript
// Importación
const { emitLevelChanged } = require("../config/sseEvents");

// En handleCallResult(), después de promover a LEAD:
if (qualificationCompleted && existingEnrichment.level !== "LEAD") {
  emitLevelChanged({
    partnerId: enrichedBy,
    establishmentId,
    previousLevel: existingEnrichment.level,
    newLevel: "LEAD",
    enrichment: { ... }
  });
}
```

#### 5. `src/app.js` (MODIFICADO)

Se registraron las nuevas rutas de eventos:

```javascript
const eventsRoutes = require("./routes/events");
// ...
app.use("/api/v1/events", eventsRoutes);
```

---

### Frontend (easyorder-leads)

#### 1. `src/hooks/useEnrichmentEvents.ts` (NUEVO)

Hook de React para suscribirse a eventos SSE.

```typescript
interface UseEnrichmentEventsOptions {
  onLevelChanged?: (data: EnrichmentEventData) => void;
  onEnrichmentUpdated?: (data: EnrichmentEventData) => void;
  onConnected?: (data: ConnectedEventData) => void;
  autoReconnect?: boolean;       // default: true
  reconnectInterval?: number;    // default: 5000ms
  enabled?: boolean;             // default: true
}

interface UseEnrichmentEventsReturn {
  isConnected: boolean;
  lastEvent: EnrichmentEventData | null;
  error: string | null;
  reconnect: () => void;
  disconnect: () => void;
}

// Uso:
const { isConnected } = useEnrichmentEvents({
  onLevelChanged: (data) => {
    // Refrescar datos cuando cambie el nivel
  },
  onEnrichmentUpdated: (data) => {
    // Manejar actualizaciones sin cambio de nivel
  },
});
```

**Características:**
- Conexión automática al montar
- Reconexión automática con backoff de 5 segundos
- Desconexión limpia al desmontar
- Manejo de errores robusto
- Heartbeat para detectar conexiones muertas

#### 2. `src/app/mis-negocios/page.tsx` (MODIFICADO)

Integración del hook SSE en la página principal.

**Cambios realizados:**

1. **Import del hook:**
```tsx
import { useEnrichmentEvents } from "@/hooks/useEnrichmentEvents";
```

2. **Import de iconos adicionales:**
```tsx
import { Wifi, WifiOff } from "lucide-react";
```

3. **Uso del hook:**
```tsx
const { isConnected: sseConnected } = useEnrichmentEvents({
  onLevelChanged: useCallback((data) => {
    // Notificación al usuario
    toast.success(
      `¡Establecimiento actualizado a ${LEVEL_LABELS[data.newLevel]}!`,
      { duration: 4000 }
    );

    // Refrescar tabla de datos
    loadEnrichments(activeLevel);
    
    // Actualizar contadores de niveles (cards)
    setStatsRefreshKey(prev => prev + 1);
  }, [activeLevel, loadEnrichments]),
  
  onEnrichmentUpdated: useCallback((data) => {
    if (data.previousLevel === data.newLevel) {
      loadEnrichments(activeLevel);
    } else {
      setStatsRefreshKey(prev => prev + 1);
    }
  }, [activeLevel, loadEnrichments]),
});
```

4. **Indicador visual de conexión:**
```tsx
<Tooltip>
  <TooltipTrigger asChild>
    <span className="inline-flex items-center">
      {sseConnected ? (
        <Wifi className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <WifiOff className="h-3.5 w-3.5 text-gray-400" />
      )}
    </span>
  </TooltipTrigger>
  <TooltipContent side="right">
    {sseConnected 
      ? "Actualizaciones en tiempo real activas" 
      : "Sin conexión en tiempo real"}
  </TooltipContent>
</Tooltip>
```

#### 3. `src/hooks/index.ts` (MODIFICADO)

Se agregó la exportación del nuevo hook:

```typescript
export { useEnrichmentEvents, type EnrichmentEventData } from './useEnrichmentEvents';
```

---

## Flujo de Datos Completo

### Escenario: Agente Python califica un PROSPECT a LEAD

1. **Agente Python** llama a:
   ```
   PATCH /api/v1/qualification/call-result
   Body: { establishmentId, qualificationCompleted: true, ... }
   ```

2. **qualificationController.js** procesa la solicitud:
   - Actualiza `EstablishmentEnrichment.level = "LEAD"`
   - Detecta que `previousLevel !== newLevel`
   - Llama a `emitLevelChanged()`

3. **sseEvents.js** recibe la emisión:
   - Busca clientes conectados para ese `partnerId`
   - Formatea mensaje SSE
   - Envía a todos los clientes del partner

4. **useEnrichmentEvents.ts** en el frontend:
   - Recibe evento `enrichment:level-changed`
   - Parsea los datos
   - Llama al callback `onLevelChanged`

5. **mis-negocios/page.tsx** procesa el callback:
   - Muestra toast: "¡Establecimiento actualizado a Lead!"
   - Llama a `loadEnrichments()` → Tabla se actualiza
   - Incrementa `statsRefreshKey` → Cards de stats se actualizan

---

## Configuración Requerida

### Variables de Entorno

**Backend (easyorder-partners-api/.env):**
```env
VENTAS_SERVICE_KEY=ventas-easyorder-2024
```

**Frontend (easyorder-leads/.env.local):**
```env
NEXT_PUBLIC_PARTNERS_API_URL=http://localhost:3004/api/v1
NEXT_PUBLIC_VENTAS_SERVICE_KEY=ventas-easyorder-2024
```

---

## Consideraciones de Rendimiento

1. **Heartbeat cada 30 segundos**: Mantiene la conexión viva sin sobrecargar el servidor.

2. **Eventos por partner**: Solo se envían eventos a los clientes del partner afectado, no a todos.

3. **Reconexión inteligente**: Si la conexión se pierde, espera 5 segundos antes de reconectar para evitar loops.

4. **Limpieza de conexiones**: Las conexiones muertas se limpian automáticamente cuando el cliente se desconecta.

5. **Sin polling**: El frontend no hace requests periódicos; solo recibe eventos cuando hay cambios.

---

## Eventos SSE Disponibles

| Evento | Descripción | Cuándo se emite |
|--------|-------------|-----------------|
| `connected` | Conexión establecida exitosamente | Al conectar |
| `heartbeat` | Keep-alive | Cada 30 segundos |
| `enrichment:level-changed` | Un establecimiento cambió de nivel | Al cambiar CONTACT→PROSPECT→LEAD→CLIENT |
| `enrichment:updated` | Datos actualizados sin cambio de nivel | Al actualizar datos sin cambiar nivel |

---

## Debugging

### Backend
Los logs se emiten con el prefijo `[SSE]`:
```
[SSE] Cliente conectado: partner uuid-partner-123
[SSE] Evento level-changed emitido: est-123 de PROSPECT a LEAD
[SSE] Cliente desconectado: partner uuid-partner-123
```

### Frontend
Los logs se emiten en la consola del navegador:
```
[SSE] Conexión SSE abierta
[SSE] Conexión establecida: Conexión SSE establecida
[SSE] Nivel cambiado: est-123 PROSPECT -> LEAD
```

---

## Endpoints de Monitoreo

```
GET /api/v1/events/stats
```
Devuelve estadísticas de conexiones SSE (solo admin):
```json
{
  "success": true,
  "data": {
    "totalConnections": 5,
    "partnerConnections": {
      "partner-uuid-1": 2,
      "partner-uuid-2": 3
    }
  }
}
```

---

## Limitaciones y Mejoras Futuras

1. **Limitación actual**: Si el usuario tiene múltiples pestañas abiertas, cada una mantiene una conexión SSE separada. Se podría implementar BroadcastChannel para compartir una sola conexión.

2. **Mejora futura**: Agregar filtros para que el frontend pueda suscribirse solo a ciertos tipos de eventos o establecimientos específicos.

3. **Mejora futura**: Implementar retry con exponential backoff en lugar de intervalo fijo de 5 segundos.

---

## Impacto del Sistema SSE en el Servidor

### Recursos del Servidor

#### Conexiones Activas

Cada cliente conectado al endpoint SSE mantiene una conexión HTTP persistente:

```
┌─────────────────────────────────────────────────────────────┐
│                    SERVIDOR EXPRESS                          │
├─────────────────────────────────────────────────────────────┤
│  Conexiones SSE activas: N conexiones                       │
│                                                              │
│  Cada conexión consume:                                      │
│  - 1 socket TCP abierto (~1KB de memoria)                   │
│  - 1 objeto Response de Express (~2-5KB)                    │
│  - 1 intervalo de heartbeat (setInterval)                   │
│  - Entrada en el Map de connectedClients                    │
│                                                              │
│  Total estimado por conexión: ~5-10KB                       │
└─────────────────────────────────────────────────────────────┘
```

#### Límites de Conexiones

```javascript
// En sseEvents.js se limita el número de listeners
enrichmentEvents.setMaxListeners(100);
```

**Recomendaciones para producción:**
- Monitorear el número de conexiones activas vía `/api/v1/events/stats`
- Configurar `ulimit` del sistema operativo para permitir más file descriptors
- Usar un reverse proxy (nginx) con configuración adecuada para SSE

#### Configuración de Nginx para SSE

```nginx
location /api/v1/events/ {
    proxy_pass http://backend;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 86400s;  # 24 horas
    chunked_transfer_encoding off;
}
```

### Impacto en CPU

| Operación | Frecuencia | Impacto CPU |
|-----------|------------|-------------|
| Heartbeat | Cada 30s por conexión | Muy bajo (~0.01ms) |
| Evento emitido | Por actualización | Bajo (~1-5ms) |
| Registro de cliente | Una vez por conexión | Bajo (~0.5ms) |
| Formateo SSE | Por evento | Muy bajo (~0.1ms) |

**Cálculo de ejemplo:**
- 100 usuarios conectados
- Heartbeat cada 30 segundos
- = 100 / 30 = ~3.3 heartbeats por segundo
- Impacto: Insignificante

### Impacto en Memoria

```
Memoria base del módulo sseEvents: ~50KB

Por cada conexión activa:
- Map entry: ~100 bytes
- Response object ref: ~8 bytes
- Heartbeat interval ref: ~8 bytes
- Total: ~120 bytes

100 conexiones = ~12KB adicionales
1000 conexiones = ~120KB adicionales
```

### Impacto en Red

| Tipo de Mensaje | Tamaño Aproximado | Frecuencia |
|-----------------|-------------------|------------|
| Heartbeat | ~50 bytes | Cada 30s |
| connected | ~150 bytes | Una vez |
| level-changed | ~300-500 bytes | Por actualización |
| enrichment-updated | ~300-500 bytes | Por actualización |

**Ancho de banda estimado por conexión activa:**
- Heartbeat: 50 bytes × 2/min = ~100 bytes/min
- Eventos: Variable, ~500 bytes por evento
- Total idle: ~6KB/hora por conexión

### Diagrama de Flujo de Memoria

```
┌─────────────────────────────────────────────────────────────┐
│                      connectedClients (Map)                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  partnerId-1 ──► Set { res1, res2 }  ◄── 2 pestañas         │
│                                                              │
│  partnerId-2 ──► Set { res3 }        ◄── 1 pestaña          │
│                                                              │
│  partnerId-3 ──► Set { res4, res5, res6 } ◄── 3 pestañas    │
│                                                              │
└─────────────────────────────────────────────────────────────┘

Cuando un evento se emite para partnerId-1:
  1. Se busca el Set asociado: O(1)
  2. Se itera sobre el Set: O(n) donde n = pestañas del partner
  3. Se escribe a cada Response: O(1) por escritura

Complejidad total: O(n) donde n = pestañas del partner afectado
```

### Limpieza Automática de Recursos

```javascript
// Cuando un cliente se desconecta:
req.on("close", () => {
  clearInterval(heartbeatInterval);  // Limpia el intervalo
  unregisterClient(partnerId, res);  // Elimina del Map
});

// unregisterClient():
function unregisterClient(partnerId, res) {
  const clients = connectedClients.get(partnerId);
  if (clients) {
    clients.delete(res);  // Elimina la referencia
    if (clients.size === 0) {
      connectedClients.delete(partnerId);  // Limpia el Set vacío
    }
  }
}
```

### Comparación con Alternativas

| Métrica | SSE (Actual) | WebSocket | Polling (30s) |
|---------|--------------|-----------|---------------|
| Conexiones por cliente | 1 | 1 | 0 (pero requests) |
| Requests/hora (idle) | 0 | 0 | 120 |
| Memoria por cliente | ~10KB | ~15KB | ~0KB |
| Latencia de actualización | ~10ms | ~10ms | 0-30s |
| Complejidad servidor | Baja | Media | Muy baja |
| Carga DB (idle) | Ninguna | Ninguna | 120 queries/hora |

### Escalabilidad Horizontal

Para escalar horizontalmente con múltiples instancias del servidor:

```
┌─────────────────────────────────────────────────────────────┐
│                     LOAD BALANCER                            │
│                    (sticky sessions)                         │
└─────────────────┬───────────────────────────────────────────┘
                  │
        ┌─────────┼─────────┐
        │         │         │
        ▼         ▼         ▼
   ┌─────────┐ ┌─────────┐ ┌─────────┐
   │ Server1 │ │ Server2 │ │ Server3 │
   │ SSE x33 │ │ SSE x33 │ │ SSE x34 │
   └─────────┘ └─────────┘ └─────────┘
```

**Requisitos para escalar:**
1. **Sticky sessions**: El cliente debe siempre conectarse al mismo servidor
2. **Pub/Sub externo** (opcional): Redis para propagar eventos entre instancias

```javascript
// Ejemplo con Redis Pub/Sub para múltiples instancias:
// (No implementado actualmente, mejora futura)

const redis = require('redis');
const subscriber = redis.createClient();
const publisher = redis.createClient();

// En emitLevelChanged():
publisher.publish('enrichment:level-changed', JSON.stringify(data));

// En cada servidor:
subscriber.subscribe('enrichment:level-changed');
subscriber.on('message', (channel, message) => {
  const data = JSON.parse(message);
  sendToPartner(data.partnerId, channel, data);
});
```

### Monitoreo Recomendado

Métricas a monitorear en producción:

1. **Conexiones activas**: `GET /api/v1/events/stats`
2. **Memoria del proceso Node.js**: `process.memoryUsage()`
3. **File descriptors abiertos**: `lsof -p <PID> | wc -l`
4. **Eventos emitidos por minuto**: Log aggregation

```javascript
// Agregar a sseEvents.js para métricas:
let eventsEmittedCount = 0;

function emitLevelChanged(params) {
  eventsEmittedCount++;
  // ... resto del código
}

function getMetrics() {
  return {
    connections: getConnectedClientsCount(),
    eventsEmitted: eventsEmittedCount,
    memoryUsage: process.memoryUsage(),
  };
}
```

### Recomendaciones de Producción

1. **Límite de conexiones por partner**: Considerar limitar a 5 pestañas por usuario
2. **Timeout de conexión**: Cerrar conexiones idle después de 1 hora
3. **Rate limiting de eventos**: Máximo 10 eventos por segundo por partner
4. **Compresión**: Habilitar gzip para respuestas SSE en producción
5. **Monitoring**: Alertas si conexiones > 1000 o memoria > 500MB

---

## Timing y Consistencia de Datos

### Problema de Race Condition

Cuando el agente actualiza un establecimiento, puede ocurrir:

```
Tiempo ──────────────────────────────────────────────────────►

Backend:
[1] Recibe POST ─► [2] Actualiza DB ─► [3] Emite SSE ─► [4] Response

Frontend:
                                        [3a] Recibe SSE
                                        [3b] Fetch stats ────► [3c] Recibe stats
                                                                    (puede ser viejo!)
```

### Solución Implementada

Se agregó un delay de 500ms antes de refrescar las estadísticas:

```typescript
onLevelChanged: useCallback((data) => {
  // Pequeño delay para asegurar que la DB se actualice
  setTimeout(() => {
    loadEnrichments(activeLevel);
    setStatsRefreshKey(prev => prev + 1);
  }, 500);  // 500ms de margen
}, [activeLevel, loadEnrichments]),
```

**¿Por qué 500ms?**
- La transacción de Prisma típicamente completa en <100ms
- El evento SSE se emite después del `await prisma.update()`
- 500ms da margen suficiente para propagación de caché y eventual consistency
- Es imperceptible para el usuario pero asegura datos correctos
