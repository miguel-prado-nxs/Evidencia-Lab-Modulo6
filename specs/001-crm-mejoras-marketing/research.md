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

## Decisión 7: Reglas de automatización CRM (T027 — definidas con marketing)

**Fecha de definición**: 2026-07-02

### Regla 1 — Prospecto sin respuesta

| Campo | Valor |
|---|---|
| **Nombre** | Prospecto sin respuesta |
| **Trigger** | Scheduled (diario) sobre Companies |
| **Condición** | `fechaUltimaLlamada` hace más de 30 días **Y** etapa del establecimiento = `discovery_completed` |
| **Acción** | `requeue-campaign` — reagendar en la campaña de Discovery activa |
| **Endpoint** | `POST /api/v1/crm-hooks` con `action="requeue-campaign"` |

**Payload esperado** (Twenty → Partners API):
```json
{
  "action": "requeue-campaign",
  "payload": {
    "establishmentId": "{companyId}",
    "campaignId": "{campaignId}",
    "reason": "prospecto_sin_respuesta_30_dias"
  },
  "source": "twenty-workflow-prospectos-sin-respuesta"
}
```

**Notas de implementación para T028**:
- Usar trigger `Schedule` en Twenty (diario, ej. 9:00 AM) que filtre Companies con `fechaUltimaLlamada < now - 30d`
- El `campaignId` de la campaña Discovery activa debe ser parametrizable en el Workflow (variable de entorno en Twenty o campo de configuración)
- El handler `requeue-campaign` en `crmHooksController.js` debe agregar el establecimiento a `CampaignContact` de la campaña indicada, verificando que no exista ya con status PENDING

---

### Regla 2 — Cupón enviado sin redimir

| Campo | Valor |
|---|---|
| **Nombre** | Cupón enviado sin redimir |
| **Trigger** | Scheduled (cada hora o diario) sobre registros de cupón |
| **Condición** | Cupón enviado hace más de 24 horas sin redención registrada |
| **Acción** | `send-whatsapp` — recordatorio al establecimiento |
| **Endpoint** | `POST /api/v1/crm-hooks` con `action="send-whatsapp"` |

**Payload esperado** (Twenty → Partners API):
```json
{
  "action": "send-whatsapp",
  "payload": {
    "establishmentId": "{companyId}",
    "templateName": "recordatorio_cupon",
    "variables": {
      "nombre": "{companyName}"
    }
  },
  "source": "twenty-workflow-cupon-sin-redimir"
}
```

**Restricción crítica**: El cupón vence a las 48 horas del envío. El trigger a las 24 horas garantiza que el recordatorio llega cuando el cupón aún está activo. No disparar si el cupón ya fue redimido (`couponStatus = redeemed`) o ya venció.

**Notas de implementación para T028**:
- El Workflow de Twenty debe poder acceder al campo de fecha de envío del cupón. Evaluar si la Note de `coupon_sent` tiene metadata suficiente o si se requiere un campo custom en Twenty.
- El handler `send-whatsapp` en `crmHooksController.js` debe llamar `couponWhatsappService` con el template `recordatorio_cupon` (crear template si no existe).
- Verificar que el cupón no esté ya redimido antes de enviar — consultar `CampaignCoupon` por `establishmentId` con `status != redeemed`.

---

### Resumen de acciones requeridas por regla

| Regla | Acción crm-hooks | Handler a implementar en T028 |
|---|---|---|
| Prospecto sin respuesta | `requeue-campaign` | Agregar a `CampaignContact` de campaña Discovery activa |
| Cupón sin redimir | `send-whatsapp` | Llamar `couponWhatsappService` con template `recordatorio_cupon` |

---

## Decisión 8: Convenciones de roles RBAC en Twenty (T029 — configurado 2026-07-02)

| Rol en Twenty | Equivalente funcional | Ver | Editar | Eliminar | Destruir | Config |
|---|---|---|---|---|---|---|
| Marketing Ops | Marketing | ✅ | ✅ | ✗ | ✗ | Espacio de trabajo + Workflows |
| SDR manager | Ventas | ✅ | ✅ | ✅ | ✗ | Ninguna |
| miembro | Solo lectura | ✅ | ✗ | ✗ | ✗ | Ninguna |
| Admin | Administrador | ✅ | ✅ | ✅ | ✅ | Total |

---

## Meta Lead Ads discovery (T032 — investigado 2026-07-03)

**Fuente**: Documentación oficial de Meta for Developers.

### 1. Webhooks — CONFIRMADO

Meta soporta notificaciones webhook en tiempo real para leads de Facebook/Instagram Ads:

- Suscripción al objeto **Page** con el campo **`leadgen`**
- Instalación de la app en la página vía `POST /{page-id}/subscribed_apps` con el Page Access Token
- Cuando un usuario completa un lead ad, Meta envía una notificación al endpoint webhook con un `leadgen_id` — **no envía los datos del lead directamente**, solo el ID. Hay que hacer una llamada adicional a la Marketing API para obtener los datos completos.

**Payload del webhook** (notificación, no el lead completo):
```json
{
  "leadgen_id": "...",
  "page_id": "...",
  "form_id": "...",
  "adgroup_id": "...",
  "ad_id": "...",
  "created_time": 1234567890
}
```

**Implicación para la arquitectura**: el flujo sería de 2 pasos — (1) recibir webhook con `leadgen_id`, (2) hacer `GET /{leadgen_id}` a la Graph API para obtener nombre, teléfono, email, etc. del formulario.

### Endpoints involucrados

| Endpoint | Método | Propósito |
|---|---|---|
| `/{page-id}/subscribed_apps` | POST | Suscribir la app a los eventos `leadgen` de la Page |
| `/{page-id}/subscribed_apps` | GET | Verificar suscripción activa |
| Webhook propio (`/api/v1/webhooks/meta-leads`, a crear) | POST (recibe) | Endpoint donde Meta hace el `POST` con `{leadgen_id, page_id, form_id, ...}` |
| `/{leadgen_id}` | GET | Obtener los datos completos del lead (nombre, teléfono, email, respuestas del formulario) usando el Page Access Token |
| `/{page-id}/leadgen_forms` | GET | Listar los formularios de lead ads de la página (para mapear `form_id` a una campaña/oferta) |

### 2. Permisos y App Review — CONFIRMADO (bloqueante)

Para leer datos de leads se requiere pasar por **App Review de Meta** con los siguientes permisos:

| Permiso | Obligatorio |
|---|---|
| `leads_retrieval` | Sí — requerido para leer leads |
| `pages_manage_ads` | Sí |
| `pages_read_engagement` | Recomendado |
| `pages_show_list` | Recomendado |
| `ads_management` | Recomendado |

Después de la aprobación de permisos, Meta exige adicionalmente **Verificación de Negocio** (Business Verification) — proceso que puede tardar días/semanas y requiere documentación legal de la empresa.

### 3. Deduplicación — VIABLE

El `leadgen_id` es único por lead y puede usarse directamente como clave de deduplicación (mismo patrón que `dedupeKey` en `TwentySyncJob`). No hay riesgo de duplicados del lado de Meta si se usa este ID como llave única en la tabla de destino.

### 4. Riesgos identificados

- **Tiempo de aprobación no controlable**: el App Review de Meta no tiene SLA garantizado — puede tomar semanas y ser rechazado por documentación insuficiente.
- **Verificación de Negocio** es un proceso administrativo separado, con requisitos legales (RFC, comprobante de domicilio fiscal, etc.) que no depende del equipo técnico.
- **Page Access Token** tiene rate limits basados en usuarios activos de la página — bajo volumen de la página de EasyOrder podría limitar el throughput inicial.
- El webhook solo notifica el ID — cada lead implica una llamada adicional a la Graph API, sumando latencia y consumo de rate limit.

### Evaluación de viabilidad

**Veredicto: VIABLE técnicamente, con bloqueante administrativo fuera del control del equipo de desarrollo.**

- La arquitectura es directamente compatible con el patrón ya usado en este proyecto: un webhook entrante + un job de la cola (mismo modelo que `TwentySyncJob`/`CampaignContact`) para el segundo llamado a la Graph API y la deduplicación por `leadgen_id`.
- No hay obstáculo técnico de integración en sí — el riesgo real es de **plazo y control**: el App Review y la Verificación de Negocio de Meta dependen de un tercero (Meta) y de documentación legal de la empresa, no de trabajo de ingeniería.
- Recomendación: iniciar el proceso de App Review y Verificación de Negocio **en paralelo** a cualquier otro desarrollo (no bloquea otras tareas), dado que su duración es la variable menos predecible del proyecto.

### Tiempo estimado de integración

| Fase | Estimado | Depende de |
|---|---|---|
| Solicitud de App Review + Verificación de Negocio en Meta | 1–4 semanas (fuera de nuestro control, sin SLA de Meta) | Documentación legal de la empresa (RFC, comprobante de domicilio fiscal) |
| Desarrollo del endpoint webhook + job de procesamiento (siguiendo patrón `TwentySyncJob`) | 2–3 días | Ninguno — puede empezar antes de que Meta apruebe, usando datos de prueba |
| Mapeo de `form_id` → campaña/oferta y flujo de creación de `LeadProspect`/`CallLead` | 1–2 días | Definición de negocio: qué formularios de Meta corresponden a qué oferta |
| Pruebas E2E con lead real de Meta Ads | 1–2 días | Que la app ya esté aprobada y el `leads_retrieval` esté activo |
| **Total estimado (desarrollo)** | **4–7 días de trabajo técnico** | — |
| **Total estimado (calendario, incluyendo espera de Meta)** | **2–5 semanas** | Depende enteramente del tiempo de respuesta de Meta |

### Fuentes

- [Meta Webhooks for Lead Ads for Customer Relationship Management](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/quickstart/webhooks-integration)
- [Leads - Webhooks from Meta - Documentation](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-leadgen/)
- [Retrieving Leads - Meta for Developers](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/retrieving)

---

### Addendum (2026-07-07): Reutilización de la App de Meta de `roasify.ai`

Se identificó que el proyecto hermano **roasify.ai** (Nexgen) ya tiene una App de Meta en producción (`1229314395871849`, Business Manager) con:

- **Business Verification** — aprobada.
- **Access Verification (Tech Provider)** — aprobada.
- **App Review de `ads_read`** — aprobado y en uso (solo lectura de métricas de campaña, sin `leads_retrieval` ni `ads_management`).

**Hallazgo clave**: el App Review ya enviado y aprobado fue **únicamente para `ads_read`** — `leads_retrieval` y `pages_manage_ads` (los permisos que necesita esta integración) **nunca se solicitaron**. Meta revisa por permiso, no por app completa, así que sigue siendo obligatorio un **App Review nuevo y separado** para estos dos permisos.

**Impacto en el estimado**: se elimina la espera de Business Verification y Access Verification (las partes más largas y menos predecibles del proceso, normalmente 3-5+ días hábiles cada una) porque ya están resueltas a nivel de app. Queda pendiente únicamente el ciclo de App Review del permiso nuevo.

| Fase | Estimado original (T032) | Estimado actualizado (reusando app de Roasify) |
|---|---|---|
| Alta de app + Business Verification + Tech Provider | Incluido en las 2–5 semanas | **0 — ya resuelto** |
| App Review de `leads_retrieval` + `pages_manage_ads` | Incluido en las 2–5 semanas | 1–3 semanas (sin SLA garantizado, pero sin las dependencias previas) |
| **Total estimado (calendario)** | 2–5 semanas | **1–3 semanas** |

**Acción requerida antes de enviar el nuevo App Review**: coordinar con el operador de `roasify.ai` para (a) obtener acceso a `meta_app_id`/`meta_app_secret` para `config/env.js` de Partners API, y (b) redactar un caso de uso propio para `leads_retrieval`/`pages_manage_ads` — el caso de uso existente de Roasify está explícitamente acotado a "solo lectura, sin permisos de gestión" y no puede reutilizarse tal cual; se necesita una justificación separada y honesta sobre el segundo propósito (captura de leads) dentro de la misma app.

---

## Manychat discovery (T033 — investigado 2026-07-03)

**Fuente**: Documentación oficial de Manychat Help + comunidad de desarrolladores.

### 1. Modelo de integración — INVERSO al de Meta

A diferencia de Meta (nosotros recibimos webhook + hacemos pull), Manychat funciona con **"External Request"**: es una acción dentro de un Flow de Manychat que, al dispararse un trigger, hace un `POST` saliente hacia una URL nuestra con los datos del suscriptor. No hay que suscribirse a nada desde nuestro lado — se configura en la UI de Manychat.

### 2. Autenticación — CONFIRMADO

- Requiere **cuenta Pro** de Manychat para generar la API Key (Bearer token) desde la pantalla de configuración de la página.
- Para el caso de uso principal (Manychat empuja datos hacia nosotros vía External Request), **no se necesita la API Key de Manychat** — solo protegemos nuestro propio endpoint con `authenticateApiKey`, igual que `/crm-hooks`.
- La API Key de Manychat solo sería necesaria si quisiéramos hacer el flujo inverso (nosotros consultando datos de un suscriptor específico desde Manychat).

### Endpoints involucrados

| Endpoint | Dirección | Propósito |
|---|---|---|
| External Request (configurado en el Flow de Manychat) | Manychat → nosotros | Manychat hace `POST` a nuestra URL cuando se dispara el trigger, con los datos del suscriptor |
| Endpoint propio (`/api/v1/webhooks/manychat-leads`, a crear) | Recibe | Donde llega el `POST` de Manychat |
| `GET /fb/subscriber/getInfo` (API de Manychat, opcional) | Nosotros → Manychat | Solo si se necesita consultar datos adicionales de un suscriptor por su `subscriber_id` |

### 3. Formato de datos — CONFIRMADO

Solo se soporta JSON en el body. Ejemplo de payload configurable en el Flow (con "Add Full Subscriber Data" se pueden incluir todos los campos):

```json
{
  "id": 123456,
  "first_name": "John",
  "last_name": "Doe",
  "email": "me@mail.com",
  "phone": "+521234567890"
}
```

**Limitación técnica**: el timeout del External Request es fijo de 10 segundos y no se puede configurar — nuestro endpoint debe responder rápido (idealmente sin trabajo síncrono pesado, siguiendo el mismo patrón que `/crm-hooks`: responder 200 inmediato y procesar en background).

### 4. Triggers disponibles — CONFIRMADO

- Nuevo suscriptor se une a un Flow
- Se agrega o se remueve una etiqueta (tag)
- Se dispara una palabra clave (keyword) en la conversación

**Implicación de negocio**: cualquiera de estos tres puede usarse como punto de entrada de un lead — por ejemplo, un usuario que escribe "quiero información" en WhatsApp/Instagram y dispara la keyword, lo cual activa el External Request hacia nuestro sistema.

### 5. Riesgo importante — cambio de pricing 2026 (SIN CONFIRMAR OFICIALMENTE)

Se encontraron discusiones de comunidad (no documentación oficial) indicando que en 2026 Manychat movió el acceso completo a su API a un plan de **$200/mes**, distinto del Plan Pro de entrada ($15/mes). Esto podría afectar específicamente el uso de la **API Key para consultas** (punto 2), pero no necesariamente el **External Request** saliente de un Flow, que es una función de automatización del producto, no de la API REST.

**Acción requerida antes de comprometerse**: confirmar directamente con soporte de Manychat o con la cuenta actual de EasyOrder si "External Request" sigue disponible en el plan Pro estándar, antes de construir sobre este mecanismo.

### Evaluación de viabilidad

**Veredicto: VIABLE, y de menor complejidad técnica que Meta Lead Ads.**

- No requiere App Review ni verificación de negocio — es configuración dentro de la cuenta de Manychat de EasyOrder.
- El endpoint que recibiría los datos sigue el mismo patrón ya construido para `/crm-hooks` y los webhooks de ElevenLabs — bajo riesgo de implementación.
- Único bloqueante potencial: el costo del plan si el pricing 2026 realmente restringió el External Request (pendiente de confirmar, ver punto 5).

### Tiempo estimado de integración

| Fase | Estimado | Depende de |
|---|---|---|
| Confirmar plan/pricing de Manychat con soporte o cuenta actual | 1–3 días (espera de respuesta de soporte) | Terceros (Manychat) |
| Desarrollo del endpoint webhook + job de procesamiento (patrón `/crm-hooks`) | 1–2 días | Ninguno |
| Configuración del Flow/trigger en Manychat (UI, sin código) | 0.5 día | Acceso a la cuenta de Manychat de EasyOrder |
| Mapeo de datos del suscriptor → `LeadProspect`/`CallLead` y deduplicación por `id` del suscriptor | 1 día | Definición de negocio: qué tags/keywords corresponden a qué oferta |
| Pruebas E2E con un Flow real | 0.5–1 día | Que el Flow esté configurado |
| **Total estimado (desarrollo)** | **3–4.5 días de trabajo técnico** | — |
| **Total estimado (calendario)** | **1–2 semanas** | Principalmente por la confirmación de pricing, no por desarrollo |

### Comparación rápida Meta vs. Manychat

| Aspecto | Meta Lead Ads | Manychat |
|---|---|---|
| Requiere aprobación externa | Sí (App Review + Verificación de Negocio) | No |
| Complejidad técnica | Media (2 llamadas por lead) | Baja (1 POST entrante) |
| Tiempo estimado (calendario) | 2–5 semanas | 1–2 semanas |
| Riesgo principal | Plazo de aprobación de Meta | Confirmar si el plan actual incluye External Request |

### Fuentes

- [Dev Tools: Basics – Manychat Help](https://help.manychat.com/hc/en-us/articles/14281252007580-Dev-Tools-Basics)
- [Dev Tools: External request – Manychat Help](https://help.manychat.com/hc/en-us/articles/14281285374364-Dev-Tools-External-request)
- [How to generate a token for the Manychat API](https://help.manychat.com/hc/en-us/articles/14959510331420-How-to-generate-a-token-for-the-Manychat-API-and-where-to-get-parameters)
- [Pro plan – Manychat Help](https://help.manychat.com/hc/en-us/articles/25800228332572-Pro-plan)
- [2026 New Pricing Plan: API only available on the $200/month plan?? (comunidad, sin confirmar oficialmente)](https://community.manychat.com/general-q-a-43/2026-new-pricing-plan-api-only-available-on-the-200-month-plan-9535)

---

## Decisión go/no-go: Meta Lead Ads + Manychat (T034 — decidido 2026-07-03, revisado 2026-07-07)

**Decisión original (2026-07-03)**: GO para ambos canales, aprobado con liderazgo.

**Revisión (2026-07-07) — feedback del equipo de ventas**: Manychat pasa a **GO diferido / no-go por ahora**, no por razón técnica sino de negocio. Ventas señaló que con la base de usuarios actual (aún pequeña), la confianza inicial del prospecto se construye mejor con contacto humano directo — automatizar la primera respuesta vía Manychat puede interponerse en ese proceso antes de que haya suficiente volumen para justificarlo. La herramienta sigue siendo útil, pero **prematura en esta etapa**.

**Decisión final**:
1. **Meta Lead Ads → GO, prioridad única por ahora.** Es un canal de *intención explícita* (el usuario llena un formulario en un anuncio) — no compite con el trato humano de ventas de la misma forma. Además, ya se identificó que la app de Meta de `roasify.ai` reduce el tiempo estimado a 1–3 semanas (ver addendum de Meta Lead Ads discovery) al reutilizar Business Verification y Tech Provider ya aprobados — solo falta el App Review de `leads_retrieval` + `pages_manage_ads`.
2. **Manychat → en pausa.** No se descarta — se revisita cuando la base de usuarios/conversaciones crezca lo suficiente para que la automatización de primer contacto no reste valor al proceso de ventas actual. El discovery técnico (T033) queda vigente y documentado para cuando se retome.

**Siguiente paso**: crear spec independiente (fuera de `001-crm-mejoras-marketing`) **solo para Meta Lead Ads** por ahora, con alcance, modelo de datos de entidad (destino: `LeadProspect`/`CallLead`) y estimación de esfuerzo. La deduplicación multi-canal (FR-017) se simplifica mientras Manychat no esté activo — se retoma si/cuando se sume ese canal.

**Rationale actualizado**: la decisión técnica (T032/T033) evaluó viabilidad de ingeniería, pero la decisión de negocio prioriza el canal que no interfiere con el proceso de venta actual. Meta Lead Ads no reemplaza el contacto humano — solo capta la intención inicial que hoy se pierde; Manychat sí podría hacerlo prematuramente dado el volumen actual.

**Criterios de diseño**:
- Marketing Ops puede editar registros (agregar comentarios, etiquetas, actualizar etapa) pero no eliminar — evita pérdida accidental de historial.
- SDR manager puede eliminar (para limpiar duplicados y contactos erróneos) pero no destruir — la destrucción es irreversible.
- miembro es pura consulta — sin modificaciones. Útil para stakeholders externos, dirección, o integraciones de solo lectura.
- Destruir solo para Admin — acción permanente que omite soft delete.
- Config de Workflows solo para Marketing Ops — gestionar automatizaciones es parte de su trabajo.
- El rol nativo "Member" de Twenty no se modifica — tiene revocaciones individuales por objeto que lo hacen inutilizable como solo lectura. Se usa el rol custom "miembro" en su lugar.

---

## Script de verificación (T001 — ejecutado)

`prisma/scripts/verify-twenty-notes.js` — ejecutado contra `https://api.crm.development.easyorder.mx`.

Resultados:
- `POST /notes` con `body` (string plano): **FAIL** — campo no existe
- `POST /notes` con `bodyV2: { markdown }`: **PASS** — noteId generado correctamente
- `POST /noteTargets` con `{ noteId, companyId }`: **PASS** — noteTargetId generado correctamente
