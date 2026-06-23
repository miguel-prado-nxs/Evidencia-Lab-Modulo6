# Research: Mejoras CRM para Marketing

**Feature**: 001-crm-mejoras-marketing | **Date**: 2026-06-18

## Decisión 1: Extensión de TwentySyncJob vs tabla nueva

**Decision**: Extender `TwentySyncJob` existente con campos `type`, `payload`, `dedupeKey` y `maxAttempts`.

**Rationale**: La tabla ya tiene el worker, el mecanismo de reintentos con backoff, los estados PENDING/PROCESSING/DONE/FAILED y los índices adecuados. Crear una tabla separada duplicaría esa infraestructura sin beneficio. La distinción por `type` es suficiente para bifurcar el comportamiento en el worker.

**Alternatives considered**:
- Tabla separada `TwentyInteractionJob`: descartada por duplicación de infraestructura.
- Bull queue separada: descartada porque agrega complejidad de inicio/monitoreo sin ventaja para el volumen esperado.

---

## Decisión 2: STAGE_CONFIG como mapa de configuración

**Decision**: Definir un mapa de configuración `STAGE_CONFIG` en `twentyActivityService.js` con una entrada por etapa/evento (discovery, qualification, activation, conversion, coupon_sent, coupon_redeemed).

```javascript
const STAGE_CONFIG = {
  discovery: {
    noteTitle: (outcome) => `Llamada Discovery — ${outcome}`,
    outcomeLabel: { COMPLETED: 'Contacto realizado', NO_ANSWER: 'Sin respuesta', VOICEMAIL: 'Buzón de voz', FAILED: 'Fallo técnico' },
    isConversational: (outcome) => outcome === 'COMPLETED',
  },
  qualification: { ... },
  activation: { ... },
  conversion: { ... },
  coupon_sent: { ... },
  coupon_redeemed: { ... },
};
```

**Rationale**: El CLAUDE.md pide explícitamente "patrones extensibles (mapas de configuración) sobre switches/ifs hardcodeados". Agregar un quinto agente o tipo de evento es solo agregar una entrada al mapa.

**Alternatives considered**: Switch/case por etapa — descartado por ser frágil ante cambios y contradecir los principios del proyecto.

---

## Decisión 3: Política de reintentos diferenciada por conversacionalidad

**Decision**: El campo `maxAttempts` (nullable) en `TwentySyncJob` controla el límite:
- `maxAttempts = null` → reintentos sin límite (solo para INTERACTION de llamadas conversacionales y PIPELINE)
- `maxAttempts = 5` → best effort (INTERACTION de FAILED/NO_ANSWER/VOICEMAIL, cupones)

El worker respeta esta regla al procesar: si `attempts >= maxAttempts` y `maxAttempts != null`, marca como FAILED sin reintento.

**Rationale**: Acordado en clarifications (Q1). Llamadas con conversación real tienen valor de negocio alto (historial de ventas); su pérdida sería invisible para el equipo. Llamadas fallidas son ruido operativo tolerable.

**Alternatives considered**:
- Límite uniforme de 5 para todos: descartado (pierde interacciones de valor en caso de outage de Twenty).
- Sin límite para todos: descartado (acumula jobs zombie por llamadas fallidas).

---

## Decisión 4: Note body en formato markdown vs blocknote — CONFIRMADO

**Decision**: Usar `bodyV2: { markdown: "string" }` en el POST a `/notes`. El campo `body` (string plano) no existe en esta instancia.

**Rationale**: Verificado empíricamente con `prisma/scripts/verify-twenty-notes.js` contra la instancia `https://api.crm.development.easyorder.mx`. Twenty acepta markdown plano dentro del objeto `bodyV2.markdown` y lo convierte automáticamente a blocknote internamente. La respuesta devuelve `bodyV2` con dos campos: `markdown` (el input original) y `blocknote` (JSON auto-generado). Renderiza correctamente en la UI.

**Formato de creación** (input al POST):
```json
{
  "title": "Llamada Discovery — Sin respuesta — 19/06/2026 14:30",
  "bodyV2": {
    "markdown": "**Campaña**: NombreCampaña\n**Etapa**: Discovery\n**Resultado**: Sin respuesta\n**Duración**: 45s\n**ID conversación**: `conv-abc123`"
  }
}
```

**Formato de la respuesta** (bodyV2 devuelto):
```json
{
  "bodyV2": {
    "markdown": "...",
    "blocknote": "[{ ... JSON blocknote auto-generado ... }]"
  }
}
```

**Alternatives considered**: `body` (string plano) — descartado, el campo no existe en esta instancia. JSON blocknote directo en `bodyV2` — descartado, la API solo acepta `{ markdown: string }` como input.

---

## Decisión 5: Idempotencia del PATCH de campos del Company

**Decision**: `fechaUltimaLlamada` solo se actualiza si el timestamp de la llamada actual es **más reciente** que el campo existente. `totalLlamadasCampana` se incrementa con un valor absoluto calculado en BD (count de jobs INTERACTION completados para ese establecimiento), no un "+1" ciego.

**Rationale**: Un job que reintenta tras crear la Note pero fallar el PATCH podría incrementar el contador dos veces con un "+1" ciego. El contador calculado desde la BD es siempre correcto independientemente de cuántas veces se ejecute el job.

**Alternatives considered**: Incremento optimista "+1": descartado por riesgo de doble conteo en reintentos.

---

## Decisión 6: Orden de operaciones en processInteractionJob

**Decision**: Secuencia dentro de `processInteractionJob`:
1. Resolver `twentyEstablecimientoId` desde `TwentySyncState` (si no existe, ejecutar pipeline sync primero)
2. `createNote(title, body)` → `noteId`
3. `createNoteTarget(noteId, { companyId: twentyEstablecimientoId })`
4. `PATCH Company` con `ultimaCampana`, `fechaUltimaLlamada`, `totalLlamadasCampana`

Si el paso 4 falla pero el 3 ya se completó (Note creada), el job reintenta. Para evitar nota duplicada en el reintento, el `dedupeKey` garantiza que el job no se crea dos veces — el reintento es del mismo job, no uno nuevo. La Note ya existe, pero los pasos 2 y 3 son idempotentes si se hace UPSERT por `dedupeKey` o se verifica existencia antes de crear.

**Rationale**: La atomicidad completa no es posible sin transacciones distribuidas. La estrategia es hacer cada paso idempotente o skippable en reintento.

---

## Hallazgo: `enqueueSync` actual colapsa por establishmentId

El método `enqueueSync` en `twentySyncService.js` mantiene un solo job PENDING por establecimiento (colapso de jobs). Esta lógica debe aplicarse **solo a type PIPELINE**. Para INTERACTION, cada job es único por `dedupeKey` y no debe colapsarse.

**Implicación en CRM-847**: La migración debe preservar el comportamiento de colapso para PIPELINE. El campo `type` default `PIPELINE` garantiza que los jobs existentes no se alteren.

---

## Hallazgo: twentySyncWorker usa `processPendingJobs` del servicio

El worker en `src/workers/twentySyncWorker.js` importa `processPendingJobs` de `twentySyncService.js`. Para despachar por tipo, la modificación se hace en `processPendingJobs`: al procesar cada job, bifurca según `job.type`:
- `PIPELINE` → flujo actual (sin cambios)
- `INTERACTION` → `processInteractionJob(job)` del nuevo `twentyActivityService.js`

Esto evita tocar el worker directamente más allá de importar el nuevo servicio.

---

## Hallazgo: funnelWebhookService — line numbers de los end*Call

| Función | Línea | Parámetros relevantes para sync |
|---|---|---|
| `endDiscoveryCall` | 398 | `conversationId`, `establishmentId`, `outcome`, `callSummary`, `callDuration` |
| `endActivationCall` | 664 | `conversationId`, `establishmentId`, `outcome`, `callSummary` |
| `endQualificationCall` | 1239 | `conversationId`, `establishmentId`, `outcome`, `callSummary` |
| `endConversionCall` | 1558 | `conversationId`, `establishmentId`, `outcome`, `planClosed`, `callSummary` |

El helper a factorizar en CRM-851:

```javascript
// Helper a crear en funnelWebhookService.js o utils separado
async function enqueueCampaignSync(stage, { conversationId, establishmentId, outcome, callSummary, callDuration, campaignId }) {
  // non-blocking: no await, solo fire-and-forget con log en catch
  enqueueSync({ establishmentId, reason: `CAMPAIGN_${stage.toUpperCase()}_CALL` }).catch(err =>
    logger.error(`[FunnelWebhook:enqueueCampaignSync] Error pipeline sync`, { err, stage, establishmentId })
  );
  enqueueInteractionSync({ establishmentId, conversationId, stage, outcome, callSummary, callDuration, campaignId }).catch(err =>
    logger.error(`[FunnelWebhook:enqueueCampaignSync] Error interaction sync`, { err, stage, establishmentId })
  );
}
```

---

## Spike CRM-861/862 — Hallazgos (T001 completado)

**Fecha**: 2026-06-19 | **Fuente**: Documentación oficial Twenty + código fuente GitHub

### 1. Workflows con HTTP_REQUEST — CONFIRMADO

Twenty Workflows **soporta HTTP Request** como tipo de acción nativa (Integration Actions > HTTP Request).

- Métodos soportados: GET, POST, PUT, PATCH, DELETE
- Configuración: URL, método, headers, body personalizable
- Las variables de pasos anteriores se pueden referenciar dinámicamente en URL y headers
- **Implicación para Fase 6 (US3)**: El endpoint `/crm-hooks` puede ser invocado directamente desde un Workflow de Twenty sin middleware adicional.

Triggers disponibles:
- `Record is Created` / `Record is Updated` / `Record is Updated or Created`
- `Record is Deleted`
- Manual, Schedule, Webhook

### 2. Endpoints REST de Notes — CONFIRMADOS

La API REST de Twenty sigue el patrón estándar. Endpoints disponibles:

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `POST` | `/api/notes` | Crear una Note |
| `GET` | `/api/notes` | Listar Notes (con paginación) |
| `GET` | `/api/notes/{id}` | Obtener Note por ID |
| `PATCH` | `/api/notes/{id}` | Actualizar Note |
| `DELETE` | `/api/notes/{id}` | Eliminar Note |
| `POST` | `/api/noteTargets` | Anclar Note a un objeto (Company, Person, etc.) |
| `DELETE` | `/api/noteTargets/{id}` | Desanclar Note |

Campos de Note (del código fuente de Twenty):
- `title`: string
- `bodyV2`: RichTextMetadata (ver hallazgo crítico abajo)
- `position`: number

Campos de NoteTarget:
- `noteId`: UUID de la Note
- `companyId`: UUID del Company (para anclar a establecimiento)

### 3. Formato del body de Note — CONFIRMADO

**Campo**: `bodyV2: { markdown: string }` — verificado empíricamente contra la instancia real.

- `body` (string plano): **NO EXISTE** en esta instancia (`Field metadata for field "body" is missing`)
- `bodyV2: { markdown: "..." }`: **FUNCIONA** — Twenty auto-convierte a blocknote internamente
- La respuesta devuelve `bodyV2` con ambos campos: `markdown` (input) y `blocknote` (JSON auto-generado)

**Formato definitivo para `createNote` en T005**:
```javascript
await this.client.post('/notes', {
  title: 'Llamada Discovery — Sin respuesta — 19/06/2026 14:30',
  bodyV2: {
    markdown: '**Campaña**: NombreCampaña\n**Etapa**: Discovery\n**Resultado**: Sin respuesta\n**ID conversación**: `conv-abc123`',
  },
});
```

Campos de `noteTargets` confirmados en respuesta: `id, noteId, companyId, personId, opportunityId, prospectoId, contactoId, clienteId, contactInteractionId`

### 4. Rate Limits — CONFIRMADOS

| Límite | Valor |
|--------|-------|
| Requests por minuto | **100 req/min** |
| Registros por batch | **60 records/call** |

**Implicación para backfill (T023)**: El script de backfill debe respetar 100 req/min. Con 3 llamadas API por interaction (createNote + createNoteTarget + updateCompany), el throughput máximo es ~33 interactions/minuto. Para volumen histórico, usar delay entre lotes.

**Implicación para operación normal**: Con 100-500 llamadas/día, la carga es mínima (~1-5 req/min en horario de campaña). Sin riesgo de throttling.

### 5. Campos custom de Establecimientos — CONFIRMADO (T002 completado)

Campos creados en Twenty UI (Settings > Data Model > Establecimientos) y verificados via API.

| Nombre en UI | API name real | Tipo |
|---|---|---|
| ultimaCampana | `ultimacampana` | Text |
| fechaUltimaLlamada | `fechaultimallamada` | Date & Time |
| totalLlamadasCampana | `totalllamadascampana` | Number |

**Importante**: Twenty convierte los nombres de campos custom a todo minúsculas en la API — ignorar el camelCase del nombre en UI. Usar estos nombres exactos en `PATCH /companies/{id}`.

---

## Script de verificación (T001 — ejecutado)

`prisma/scripts/verify-twenty-notes.js` — ejecutado contra `https://api.crm.development.easyorder.mx`.

Resultados:
- `POST /notes` con `body` (string plano): **FAIL** — campo no existe
- `POST /notes` con `bodyV2: { markdown }`: **PASS** — noteId generado correctamente
- `POST /noteTargets` con `{ noteId, companyId }`: **PASS** — noteTargetId generado correctamente
