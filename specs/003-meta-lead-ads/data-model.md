# Data Model: Integración de Meta Lead Ads con el CRM

**Feature**: 003-meta-lead-ads | **Date**: 2026-07-07

## MetaLeadConnection

Representa la Page/formulario de Meta habilitados para recibir leads. Corresponde a la entidad "Conexión de Página de Meta" del spec.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID (PK) | |
| `pageId` | String, único | ID de la Page de Facebook conectada |
| `pageAccessToken` | String (referencia a secreto, no el valor en claro) | Se almacena igual que otros tokens sensibles del proyecto — referencia, valor real fuera de la BD si se decide usar un vault; por defecto en variable de entorno dado que es una sola Page (alcance de esta fase) |
| `status` | Enum: `ACTIVE`, `TOKEN_EXPIRED`, `DISCONNECTED` | Ver Edge Case de token expirado/revocado |
| `formIdToOfferMap` | Json | Mapa `form_id → { offerName, campaignId? }` — configuración extensible en vez de hardcodear ifs (regla de CLAUDE.md) |
| `createdAt` / `updatedAt` | DateTime | |

**Validación**: `pageId` único — solo una conexión activa por Page (alcance de una sola Page en esta fase, pero el modelo no impide agregar más en el futuro).

---

## MetaLeadWebhookEvent

Notificación cruda recibida de Meta. Es la fuente de verdad para deduplicación y auditoría — corresponde a "Meta Lead Webhook Event" del spec.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID (PK) | |
| `leadgenId` | String, **único** | Identificador que Meta asigna al envío del formulario — llave de deduplicación (FR-004) |
| `pageId` | String | |
| `formId` | String | |
| `adId` | String? | Nullable — no todos los leads vienen de un anuncio pagado directo |
| `rawPayload` | Json | Body completo de la notificación, para auditoría/debug |
| `signatureValid` | Boolean | Resultado de la verificación HMAC (FR-009) — se descarta sin insertar si es `false`, pero se deja el campo para trazabilidad si se decide loguear intentos inválidos en el futuro |
| `receivedAt` | DateTime @default(now()) | |

**Regla de deduplicación**: `leadgenId` con constraint `@unique`. Insertar con upsert no-op en conflicto (Decisión 4 de `research.md`) — si ya existe, no se vuelve a encolar el procesamiento.

---

## MetaLeadJob

Job de procesamiento asíncrono — sigue el patrón de `TwentySyncJob`/`twentySyncWorker.js`.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID (PK) | |
| `webhookEventId` | UUID (FK → `MetaLeadWebhookEvent`) | |
| `status` | Enum: `PENDING`, `PROCESSING`, `DONE`, `FAILED` | Mismos estados que `TwentySyncJobStatus` |
| `attempts` | Int @default(0) | |
| `lastError` | String? | |
| `nextRunAt` | DateTime | Para backoff en reintentos |
| `completedAt` | DateTime? | |
| `createdAt` / `updatedAt` | DateTime | |

---

## MetaLead

Entidad normalizada resultante — corresponde a "Lead capturado" del spec. Es lo que el equipo de ventas ve y gestiona.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID (PK) | |
| `webhookEventId` | UUID (FK → `MetaLeadWebhookEvent`, único) | Relación 1:1 — un lead normalizado por notificación válida |
| `fullName` | String? | Del formulario |
| `phone` | String? | Normalizado al mismo formato que usa el resto del CRM |
| `email` | String? | |
| `formResponses` | Json | Respuestas adicionales del formulario, sin asumir estructura fija |
| `status` | Enum: `CAPTURED`, `INCOMPLETE_DATA`, `LINKED_TO_ESTABLISHMENT`, `UNCLASSIFIED_FORM` | Ver Edge Cases del spec — `INCOMPLETE_DATA` cuando falta teléfono válido (FR-005/SC-004), `UNCLASSIFIED_FORM` cuando el `formId` no tiene mapeo en `formIdToOfferMap` |
| `establishmentId` | String? | Nullable — se llena solo si `FR-006` encuentra match con un Establecimiento existente (BD geo). **No** es `@relation` hacia la BD geo (proyecto separado, solo lectura) — se guarda el ID como referencia simple, igual que ya hace `EstablishmentEnrichment.establishmentId` |
| `offerName` | String? | Resuelto desde `MetaLeadConnection.formIdToOfferMap` en el momento del procesamiento |
| `notifiedAt` | DateTime? | Cuándo se disparó la notificación `LEAD_NEW` a ventas (FR-010) |
| `twentyCompanyId` | String? | ID del Company en Twenty donde queda visible el lead (FR-003 exige visibilidad "en el pipeline de Prospectos del CRM" — el CRM es Twenty, no solo esta tabla interna). Se llena tras el sync: si `establishmentId` tiene match, es el Company ya existente de ese establecimiento (se ancla una Note, mismo patrón que `twentyActivityService.createNote`+`createNoteTarget`); si no hay match, se crea un Company nuevo en Twenty solo con los datos del lead |
| `twentySyncedAt` | DateTime? | Cuándo se completó el sync hacia Twenty — permite detectar leads pendientes de sincronizar si el job falla |
| `createdAt` / `updatedAt` | DateTime | |

**Transiciones de estado**:

```
CAPTURED ──(sin teléfono válido)──> INCOMPLETE_DATA
CAPTURED ──(match con Establecimiento)──> LINKED_TO_ESTABLISHMENT
CAPTURED ──(formId sin mapeo)──> UNCLASSIFIED_FORM
```

Estos estados no son mutuamente excluyentes en el tiempo de vida del lead (ej. un lead puede empezar `UNCLASSIFIED_FORM` y luego re-clasificarse manualmente) pero el spec no pide edición retroactiva en esta fase — se documenta como posible extensión futura, no como requisito actual.

---

## Relaciones

```
MetaLeadConnection ──1:N──> MetaLeadWebhookEvent (por pageId)
MetaLeadWebhookEvent ──1:1──> MetaLeadJob
MetaLeadWebhookEvent ──1:1──> MetaLead
```

## Sync hacia Twenty (cumple FR-003/FR-008/US2)

El `MetaLead` vive en la BD principal de Partners API, pero debe quedar visible en Twenty (el CRM que usa el equipo) — mismo requisito que ya resolvió `TwentySyncJob`/`twentyActivityService.js` para las llamadas de campaña. Dos casos:

- **Con `establishmentId` (match encontrado, FR-006)**: se reutiliza el `TwentySyncState` existente de ese establecimiento — se crea una Note anclada al Company ya existente (`createNote` + `createNoteTarget`, mismo patrón que las Notes de llamadas de campaña), sin crear un Company nuevo.
- **Sin match**: no existe todavía un Company en Twenty para este negocio — se crea uno nuevo con los datos capturados del formulario (nombre, teléfono), y se guarda su ID en `MetaLead.twentyCompanyId`. A diferencia del flujo de campañas de llamadas, este Company nuevo **no** tiene un `establishmentId` de la BD geo detrás — es un registro que nace directamente del lead, sin depender de que exista en DENUE.

El sync se ejecuta de forma asíncrona (fire-and-forget, mismo patrón que `enqueueInteractionSync`), para no bloquear ni depender de la disponibilidad de Twenty en el camino crítico de captura del lead.

## Nota de implementación (Prisma)

Los 4 modelos nuevos (`MetaLeadConnection`, `MetaLeadWebhookEvent`, `MetaLeadJob`, `MetaLead`) se agregan a `prisma/schema.prisma` (BD principal, no la BD geo — coherente con la regla de CLAUDE.md de que la BD geo es de solo lectura). Requiere `npm run db:migrate:dev` + `npm run db:generate` tras crear la migración.
