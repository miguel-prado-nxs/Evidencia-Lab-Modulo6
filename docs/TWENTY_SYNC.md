# Sincronizacion Twenty CRM - Partners API

## Descripcion General

Este modulo implementa la sincronizacion automatica del pipeline de establecimientos desde Partners API hacia Twenty CRM. La sincronizacion se dispara cuando un usuario de Ventas realiza acciones que avanzan el nivel de un establecimiento.

## Flujo de Pipeline

```
ESTABLISHMENT -> CONTACT -> PROSPECT -> LEAD -> CLIENT
```

Cada nivel corresponde a un tipo de registro en Twenty:

| Nivel Partners | Registro Twenty | Descripcion |
|---------------|-----------------|-------------|
| ESTABLISHMENT | Company | Establecimiento base DENUE |
| CONTACT | Company + Contacto | Establecimiento con datos de contacto |
| PROSPECT | Company + Contacto + Prospecto | Tiene tomador de decisiones |
| LEAD | Company + Prospecto + Opportunity | Lead calificado |
| CLIENT | Company + Opportunity + Cliente | Cliente que realizo compra |

## Configuracion

### Variables de Entorno

```bash
# URL base de la API de Twenty CRM
TWENTY_BASE_URL=https://api.crm.development.easyorder.mx/rest

# API Key de Twenty (requerido para habilitar sync)
TWENTY_API_KEY=your-api-key

# Habilitar/deshabilitar sync (default: true)
TWENTY_SYNC_ENABLED=true

# Intervalo de polling del worker en ms (default: 10000)
TWENTY_SYNC_INTERVAL_MS=10000

# Maximo de reintentos por job (default: 5)
TWENTY_MAX_RETRIES=5
```

## Endpoints que Disparan Sincronizacion

### 1. Agregar a Contactos
- **Endpoint**: `POST /api/v1/geo/ventas/contacts`
- **Accion**: Crea/actualiza Company en Twenty con nivelPipeline=CONTACT
- **Reason**: `ADD_TO_CONTACTS`

### 2. Convertir a Prospecto
- **Endpoint**: `POST /api/v1/geo/ventas/contacts/:establishmentId/to-prospect`
- **Accion**: Crea/actualiza Prospecto en Twenty, actualiza nivelPipeline=PROSPECT
- **Reason**: `CONTACT_TO_PROSPECT`

### 3. Actualizar Prospecto
- **Endpoint**: `PUT /api/v1/geo/ventas/prospects/:establishmentId`
- **Accion**: Actualiza datos del Prospecto en Twenty
- **Reason**: `UPDATE_PROSPECT`

### 4. Calificacion Completada (Lead)
- **Endpoint**: `POST /api/v1/qualification/call-result` (con qualificationCompleted=true)
- **Accion**: Crea/actualiza Opportunity en Twenty, actualiza nivelPipeline=LEAD
- **Reason**: `QUALIFICATION_TO_LEAD`

### 5. Conversion a Cliente
- **Endpoint**: `POST /api/v1/geo/enrichment/:establishmentId` (con purchaseDate + productPurchased)
- **Accion**: Crea/actualiza Cliente en Twenty, actualiza nivelPipeline=CLIENT
- **Reason**: `ENRICHMENT_TO_CLIENT`

### 6. Cambio de Estado de Lead
- **Endpoint**: `PUT /api/v1/leads/:id/status`
- **Accion**: Actualiza estadoLead de la Opportunity en Twenty
- **Reason**: Via `updateOpportunityStatus()`

## Reglas de Deduplicacion

La sincronizacion usa las siguientes estrategias para evitar duplicados:

### Company (Establecimiento)
1. Buscar por `sourceId` (establishmentId de Partners)
2. Si no existe, buscar por email DENUE
3. Si no existe, buscar por telefono DENUE
4. Si no existe, crear nuevo

### Contacto
1. Buscar por `establecimientoId` (ID del Company en Twenty)
2. Si no existe, buscar por email
3. Si no existe, buscar por telefono
4. Si no existe, crear nuevo

**IMPORTANTE**: No se crea contacto si no hay phone ni email disponibles. Esto se registra en logs y el sync continua.

### Prospecto
1. Buscar por `establecimientoId`
2. Si no existe, buscar por email del tomador
3. Si no existe, crear nuevo

### Opportunity
1. Buscar por `establecimientoId`
2. Si no existe, crear nuevo

### Cliente
1. Buscar por `establecimientoId`
2. Si no existe, crear nuevo

## Mapeo de Estados

### LeadStatus de Partners a estadoLead de Twenty

| Partners | Twenty |
|----------|--------|
| NEW | NUEVO |
| CONTACTED | EN_CONTACTO |
| QUALIFIED | PROPUESTA_ENVIADA |
| NEGOTIATION | NEGOCIANDO |
| WON | GANADO |
| LOST | PERDIDO |

**NOTA**: No se mapea ni modifica `pipelineVentasEasyorder` en Twenty.

## Arquitectura de Idempotencia

### Tabla TwentySyncState

Guarda el mapeo entre establishmentId de Partners y los IDs de registros en Twenty:

```prisma
model TwentySyncState {
  id                      String   @id
  establishmentId         String   @unique
  twentyEstablecimientoId String?
  twentyContactoId        String?
  twentyProspectoId       String?
  twentyOpportunityId     String?
  twentyClienteId         String?
  lastSyncedLevel         String?
  lastSyncedAt            DateTime?
  lastError               String?
  lastErrorAt             DateTime?
}
```

### Tabla TwentySyncJob (Outbox Pattern)

Cola de trabajos de sincronizacion con reintentos:

```prisma
model TwentySyncJob {
  id              String   @id
  establishmentId String
  partnerId       String?
  reason          String
  status          PENDING|PROCESSING|DONE|FAILED
  attempts        Int
  nextRunAt       DateTime
  lastError       String?
  completedAt     DateTime?
}
```

## Worker de Sincronizacion

- Se inicia automaticamente al arrancar la aplicacion si `TWENTY_API_KEY` esta configurada
- Hace polling cada `TWENTY_SYNC_INTERVAL_MS` milisegundos (default: 10s)
- Procesa hasta 5 jobs por ciclo en serie
- Implementa backoff exponencial: `min(60s * 2^attempts, 1h)`
- Maximo 5 reintentos antes de marcar como FAILED

## Manejo de Errores

1. **Errores de sincronizacion nunca rompen el request principal**
   - Se usa `enqueueSync()` que captura errores internamente
   - El job queda encolado para reintento

2. **Errores de Twenty API**
   - Se registran en `TwentySyncJob.lastError`
   - Se incrementa `attempts` y se calcula `nextRunAt` con backoff

3. **Jobs fallidos**
   - Despues de 5 intentos, el job se marca como FAILED
   - Se puede consultar via `getSyncStats()`

## Supuestos y Limites

1. **Una sola instancia de partners-api en produccion**
   - El worker corre en el mismo proceso
   - No hay coordinacion entre instancias

2. **Contacto sin phone/email**
   - No se crea registro de contacto en Twenty
   - Se loggea claramente y continua el sync
   - El contacto se crea cuando se disponga de phone/email (ej: en PROSPECT con decisionMakerPhone)

3. **Mapeo Lead -> Establishment**
   - Se infiere del campo `notes` del Lead que contiene `ID Establecimiento: xxx`
   - Si no se puede inferir, no se actualiza estadoLead en Twenty

4. **Rate Limiting de Twenty**
   - Se procesa en serie para evitar sobrecarga
   - Backoff exponencial ayuda a respetar limits

5. **Cliente solo cuando nivelPipeline es CLIENT**
   - El registro de cliente en Twenty solo se crea cuando el nivel llega a CLIENT
   - Esto ocurre cuando hay purchaseDate y productPurchased en enrichment

## Checklist de Pruebas Manuales

### 1. Agregar a Mis Contactos

```bash
POST /api/v1/geo/ventas/contacts
{
  "establishmentId": "xxx"
}
```

Verificar en Twenty:
- Company creada con nivelPipeline=CONTACT
- Contacto creado (si hay phone/email)

### 2. Convertir a Prospecto

```bash
POST /api/v1/geo/ventas/contacts/xxx/to-prospect
{
  "decisionMakerName": "Juan Perez",
  "decisionMakerPhone": "5551234567"
}
```

Verificar en Twenty:
- Company.nivelPipeline=PROSPECT
- Prospecto creado con datos del tomador
- Contacto creado (si no existia y ahora hay phone/email)

### 3. Calificacion Completada

```bash
POST /api/v1/qualification/call-result
{
  "establishmentId": "xxx",
  "qualificationCompleted": true,
  "qualificationScore": "A"
}
```

Verificar en Twenty:
- Company.nivelPipeline=LEAD
- Opportunity creada

### 4. Conversion a Cliente

```bash
POST /api/v1/geo/enrichment/xxx
{
  "purchaseDate": "2025-01-15",
  "productPurchased": "STARTER"
}
```

Verificar en Twenty:
- Company.nivelPipeline=CLIENT
- Cliente creado
- Opportunity.estadoLead=GANADO

### 5. Idempotencia

Repetir cada paso anterior y verificar:
- No se crean duplicados en Twenty
- Los registros existentes se actualizan

## Archivos Involucrados

| Archivo | Descripcion |
|---------|-------------|
| `src/config/env.js` | Variables de entorno de Twenty |
| `src/services/twenty/twentyService.js` | Cliente HTTP para Twenty API |
| `src/services/twenty/twentySyncService.js` | Orquestador de sincronizacion |
| `src/workers/twentySyncWorker.js` | Worker de procesamiento |
| `prisma/schema.prisma` | Modelos TwentySyncState y TwentySyncJob |
| `src/services/ventasEnrichmentService.js` | Integracion ADD_TO_CONTACTS, CONTACT_TO_PROSPECT |
| `src/controllers/qualificationController.js` | Integracion QUALIFICATION_TO_LEAD |
| `src/services/enrichmentService.js` | Integracion ENRICHMENT_TO_CLIENT |
| `src/services/leadService.js` | Integracion UPDATE_LEAD_STATUS |
| `src/app.js` | Inicio del worker |

## Observabilidad

Los logs incluyen:
- `establishmentId`: ID del establecimiento en Partners
- `partnerId`: ID del partner que disparo la accion
- `currentLevel`: Nivel actual del pipeline
- `twentyIds`: IDs de registros en Twenty
- `reason`: Razon del sync
- `jobId`: ID del job de sync
- `attempts`: Numero de intentos

Ejemplo de log:
```json
{
  "level": "info",
  "message": "[TwentySyncService] Sync completado exitosamente",
  "establishmentId": "abc-123",
  "partnerId": "VENTAS-456",
  "currentLevel": "PROSPECT",
  "twentyIds": {
    "establecimientoId": "twenty-est-789",
    "contactoId": "twenty-con-012",
    "prospectoId": "twenty-pro-345"
  }
}
```
