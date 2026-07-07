# Tasks: Integración de Meta Lead Ads con el CRM

**Input**: Design documents from `specs/003-meta-lead-ads/`

**Prerequisites**: [plan.md](plan.md) · [spec.md](spec.md) · [data-model.md](data-model.md) · [contracts/](contracts/) · [research.md](research.md) · [quickstart.md](quickstart.md)

**Tests**: No incluidos — validación manual según [quickstart.md](quickstart.md) (mismo criterio que `specs/001-crm-mejoras-marketing`).

**Organization**: Tareas agrupadas por historia de usuario (US1-US3 de `spec.md`) para permitir implementación y prueba independiente de cada una.

> **Regenerado 2026-07-07** tras `/speckit-clarify`: el MVP (US1) ahora incluye la visibilidad en Twenty (clarificación C1); se agregó manejo de token expirado (C2) y la verificación del Data Deletion Callback de Meta (C4/FR-011); el match es solo por teléfono (C3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Puede correr en paralelo (archivos diferentes, sin dependencias entre sí)
- **[Story]**: Historia de usuario del spec.md (US1-US3)
- **Sin [Story]**: Setup / Foundational / Polish — sin historia asociada

---

## Phase 1: Setup

**Purpose**: Configuración de credenciales y variables antes de escribir código de negocio.

- [ ] T001 Agregar `meta.appId`, `meta.appSecret`, `meta.webhookVerifyToken`, `meta.leadAdsEnabled`, `meta.pageAccessToken` a `src/config/env.js`, leídos desde variables de entorno (`META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_LEAD_ADS_ENABLED` default `false`, `META_PAGE_ACCESS_TOKEN`)
- [ ] T002 [P] Documentar las 5 variables nuevas en `.env.example`

**Checkpoint**: Configuración lista — coordinar con el operador de `roasify.ai` para obtener los valores reales antes de probar contra Meta real.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Modelo de datos y esqueleto de rutas — nada de las historias de usuario puede avanzar sin esto.

**⚠️ CRÍTICO**: Ninguna historia de usuario puede comenzar hasta que esta fase esté completa.

- [ ] T003 Migración Prisma en `prisma/schema.prisma`: agregar modelos `MetaLeadConnection`, `MetaLeadWebhookEvent`, `MetaLeadJob`, `MetaLead` (campos y enums según `data-model.md`, incluyendo `twentyCompanyId`/`twentySyncedAt` en `MetaLead` y `status` en `MetaLeadConnection`)
- [ ] T004 Ejecutar `npm run db:migrate:dev` con nombre `add_meta_lead_ads_models` + `npm run db:generate`
- [ ] T005 [P] Crear `src/routes/metaLeadsRoutes.js` montando `GET`/`POST /api/v1/webhooks/meta-leads` (sin `authenticateApiKey` — la auth es la firma HMAC, ver contrato); registrar en `src/app.js`
- [ ] T006 [P] Crear `src/services/metaLeadIngestionService.js` con la función `verifySignature(rawBody, signatureHeader)` (HMAC-SHA256 con `meta.appSecret`, comparación con `crypto.timingSafeEqual`)
- [ ] T007 [P] Definir schema Zod del payload del webhook (`object`, `entry[].changes[].value.{leadgen_id,page_id,form_id}`) en `src/controllers/metaLeadsController.js`

**Checkpoint**: Foundational completa cuando la migración está aplicada y el endpoint responde (aunque sea con lógica placeholder) sin romper el resto de la API.

---

## Phase 3: User Story 1 - Captura de leads visible en el CRM (Priority: P1) 🎯 MVP

**Goal**: Un lead que llena un formulario de Meta Lead Ads queda capturado Y **visible en Twenty** (el CRM que usa el equipo) en menos de 5 minutos, sin intervención manual. La visibilidad en Twenty es parte del MVP (clarificación C1) — no basta con persistir el lead solo en la BD interna.

**Independent Test**: Enviar una notificación de webhook válida (firmada) con un `leadgen_id` de prueba y verificar que se crea `MetaLeadWebhookEvent` + `MetaLeadJob` + (con `META_LEAD_ADS_ENABLED=true` y datos mockeados de la Graph API) un `MetaLead` que aparece como un Company/Note en Twenty. Ver Escenarios 1-3 de `quickstart.md`.

### Implementation for User Story 1

- [ ] T008 [US1] Implementar el handler `GET` en `src/controllers/metaLeadsController.js`: valida `hub.verify_token` contra `config.meta.webhookVerifyToken`, responde `hub.challenge` en texto plano o `403` (Escenario 1 de quickstart)
- [ ] T009 [US1] Implementar el handler `POST` en `src/controllers/metaLeadsController.js`: valida payload con el schema Zod (T007), verifica firma con `verifySignature` (T006) → `403` si inválida sin procesar nada; si válida, responde `200` inmediato y delega a `metaLeadIngestionService.recordWebhookEvent(payload)` de forma asíncrona (fire-and-forget con `.catch(logger.error)`, mismo patrón que `crmHooksController.js`)
- [ ] T010 [US1] Implementar `recordWebhookEvent(payload)` en `metaLeadIngestionService.js`: por cada `changes[]` con `field === 'leadgen'`, hacer upsert de `MetaLeadWebhookEvent` por `leadgenId` (no-op en conflicto — FR-004); si fue una inserción nueva y `config.meta.leadAdsEnabled === true`, encolar un `MetaLeadJob` con `status: PENDING`
- [ ] T011 [US1] Crear `src/workers/metaLeadWorker.js` siguiendo el patrón de `twentySyncWorker.js`: ciclo de polling que procesa hasta N `MetaLeadJob` en estado `PENDING` por ciclo, **de forma secuencial** (`for...await`, no `Promise.all`, para respetar el rate limit de 100 req/min de Meta), llamando a `processMetaLeadJob(job)`
- [ ] T012 [US1] Implementar `fetchLeadData(leadgenId, pageAccessToken)` en `metaLeadIngestionService.js`: `GET https://graph.facebook.com/v21.0/{leadgenId}` con axios, normaliza `field_data[]` a `{ fullName, phone, email }`
- [ ] T013 [US1] Implementar `processMetaLeadJob(job)` en `metaLeadIngestionService.js`: llama `fetchLeadData`, resuelve `offerName` desde `MetaLeadConnection.formIdToOfferMap` por `formId` (marca `UNCLASSIFIED_FORM` si no hay mapeo — edge case del spec), crea el `MetaLead` con `status: CAPTURED` (o `UNCLASSIFIED_FORM`), marca el job `DONE`
- [ ] T014 [US1] Implementar `syncMetaLeadToTwenty(metaLead)` en nuevo archivo `src/services/twenty/metaLeadTwentySync.js` (aislado del dominio de campañas): crear un Company nuevo en Twenty con nombre/teléfono del lead + una Note con los datos capturados, guardar el ID en `MetaLead.twentyCompanyId` y marcar `twentySyncedAt` (FR-003 — visibilidad en el CRM, parte del MVP)
- [ ] T015 [US1] Encolar `syncMetaLeadToTwenty` de forma asíncrona (fire-and-forget con `.catch(logger.error)`) inmediatamente después de crear el `MetaLead` en `processMetaLeadJob`
- [ ] T016 [US1] Registrar el arranque de `metaLeadWorker` en `src/app.js` (auto-inicio en dev, mismo patrón que `twentySyncWorker.start()`)
- [ ] T017 [US1] Agregar manejo explícito de errores en `processMetaLeadJob` (FR-005): si `fetchLeadData` falla (timeout, 4xx/5xx de Meta), marcar el job `FAILED` con `lastError` y `nextRunAt` con backoff, sin perder el `MetaLeadWebhookEvent` original
- [ ] T018 [US1] Detección de token expirado (FR-005 / edge case): si `fetchLeadData` recibe error de auth de Meta (HTTP 401 o código de error 190), marcar `MetaLeadConnection.status = TOKEN_EXPIRED` y disparar una notificación visible (mismo canal que `notificationService`), en vez de un fallo silencioso — para que alguien reconecte la cuenta

**Checkpoint**: US1 completa cuando los Escenarios 1-5 de `quickstart.md` pasan y un lead válido aparece como Company+Note en Twenty (con `META_LEAD_ADS_ENABLED=true` y credenciales/mocks).

---

## Phase 4: User Story 2 - Enrutamiento del lead hacia el proceso de ventas (Priority: P2)

**Goal**: Refinar el lead ya visible en Twenty para que sea accionable por ventas: notificación activa, vínculo con Establecimiento existente (sin duplicar), marcado de datos incompletos, y trazabilidad del origen visible.

**Independent Test**: Tras capturar un lead (US1), verificar que el equipo recibe la notificación `LEAD_NEW`, que un lead cuyo teléfono coincide con un Establecimiento existente se ancla a ese Company (sin crear uno nuevo), y que un lead con teléfono inválido queda `INCOMPLETE_DATA`. Ver Escenarios 6-7 de `quickstart.md`.

### Implementation for User Story 2

- [ ] T019 [US2] En `processMetaLeadJob` (extiende T013): si `fetchLeadData` no devuelve un teléfono usable, marcar `status: INCOMPLETE_DATA` en vez de `CAPTURED` (FR-005/SC-004)
- [ ] T020 [US2] Implementar `matchEstablishmentByPhone(phone)` en `metaLeadIngestionService.js`: normaliza el teléfono y busca coincidencia contra `EstablishmentEnrichment.decisionMakerPhone`/`decisionMakerWhatsApp` (FR-006 — solo por teléfono, clarificación C3; el nombre de negocio NO se usa)
- [ ] T021 [US2] Integrar el match en `processMetaLeadJob`: si `matchEstablishmentByPhone` encuentra resultado, guardar `establishmentId` y marcar `status: LINKED_TO_ESTABLISHMENT`
- [ ] T022 [US2] Modificar `syncMetaLeadToTwenty` (extiende T014): si el `MetaLead` tiene `establishmentId` con `TwentySyncState`, anclar la Note al Company existente (`createNoteTarget`) en vez de crear un Company nuevo — evita duplicar el negocio en Twenty (FR-006)
- [ ] T023 [US2] Disparar `notificationService` con el tipo `LEAD_NEW` ya existente (sin modificar `notificationService.js`) tras crear el `MetaLead`, y marcar `MetaLead.notifiedAt` (FR-010/SC-006)
- [ ] T024 [US2] [P] Incluir en el cuerpo markdown de la Note de Twenty (dentro de `syncMetaLeadToTwenty`) el formulario/anuncio/página de origen y la marca "Meta Ads" (FR-008/FR-003), para que ventas no necesite entrar a Meta Ads Manager

**Checkpoint**: US2 completa cuando: un lead nuevo dispara notificación; un lead con match se ancla al Company existente sin duplicar; un lead con teléfono inválido queda `INCOMPLETE_DATA` visible; y el origen es legible en Twenty.

---

## Phase 5: User Story 3 - Deduplicación de leads repetidos (Priority: P3)

**Goal**: Reintentos de notificación de Meta o envíos duplicados del mismo formulario no generan registros ni notificaciones repetidas.

**Independent Test**: Enviar la misma notificación de webhook dos veces (mismo `leadgen_id`) y confirmar que solo existe un `MetaLeadWebhookEvent`, un `MetaLeadJob` y un `MetaLead`. Ver Escenario 4 de `quickstart.md`.

### Implementation for User Story 3

- [ ] T025 [US3] Verificar que el `@unique` en `MetaLeadWebhookEvent.leadgenId` (T003) combinado con el upsert no-op de `recordWebhookEvent` (T010) evita crear un segundo `MetaLeadJob` ante una notificación repetida — agregar test manual explícito en `quickstart.md` si falta cobertura
- [ ] T026 [US3] Confirmar que la relación `MetaLead.webhookEventId` es `@unique` (T003), de forma que no exista más de un `MetaLead` por notificación válida aunque `processMetaLeadJob` se ejecute dos veces por un reintento del worker
- [ ] T027 [US3] Validar explícitamente (comentario/log) que la deduplicación es por `leadgenId`, no por teléfono — dos leads legítimos distintos con el mismo teléfono en formularios diferentes deben generar dos `MetaLead` distintos (Acceptance Scenario 2 de US3)

**Checkpoint**: US3 completa cuando el Escenario 4 de `quickstart.md` pasa y no hay forma de generar un `MetaLead` duplicado ante reintentos de Meta.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Cierre de la feature — compliance de Meta, coordinación externa y validación end-to-end.

- [ ] T028 [P] Verificar en el App Dashboard de Meta si `leads_retrieval` exige un Data Deletion Callback (o URL pública de instrucciones de eliminación). Si aplica, implementar el endpoint/publicar la URL **antes** del envío del App Review (FR-011 / clarificación C4)
- [ ] T029 [P] Coordinar con el operador de `roasify.ai` la obtención de `meta_app_id`/`meta_app_secret`/`page_access_token` reales y confirmar el estado del App Review de `leads_retrieval`+`pages_manage_ads` (ver `specs/001-crm-mejoras-marketing/research.md`, addendum 2026-07-07)
- [ ] T030 [P] Redactar y enviar el caso de uso de App Review para `leads_retrieval`+`pages_manage_ads` (documento operativo fuera de este repo) — bloqueado por T028 (el Data Deletion Callback debe existir antes de enviar)
- [ ] T031 Ejecutar los 7 escenarios completos de `quickstart.md` en staging con `META_LEAD_ADS_ENABLED=true` y credenciales reales, una vez aprobado el permiso; medir y documentar el tiempo real punta a punta contra SC-001 (<5 min) y SC-006 (<1 min), ajustando el intervalo de polling del worker si no cumple
- [ ] T032 Activar `META_LEAD_ADS_ENABLED=true` en producción tras la validación de T031

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup — T001-T002)
    │
Phase 2 (Foundational — T003-T007)
    │ BLOQUEA TODAS LAS FASES SIGUIENTES
    ▼
Phase 3 (US1: Captura + visibilidad en Twenty — T008-T018)  ← MVP
Phase 4 (US2: Enrutamiento — T019-T024)  ← Depende de US1
Phase 5 (US3: Deduplicación — T025-T027) ← Depende de US1
Phase 6 (Polish — T028-T032)             ← T028-T030 pueden iniciar el día 1 en paralelo
```

### User Story Dependencies

- **US1 (P1, MVP)**: Depende solo de Phase 2. Incluye el sync a Twenty (clarificación C1) — el lead queda visible en el CRM, no solo en la BD interna.
- **US2 (P2)**: Depende de US1 (opera y refina el `MetaLead`/sync que US1 crea). Incremental: US1 ya entrega valor (lead visible); US2 lo hace accionable (notificación, dedup con establecimiento, datos incompletos).
- **US3 (P3)**: Depende de US1 (la deduplicación nace en T010; esta fase es verificación/hardening).

### Parallel Opportunities

```bash
# Phase 2 — tras T003/T004 (migración):
Task T005: routes + registro en app.js
Task T006: verifySignature
Task T007: schema Zod

# Phase 6 — independientes del código, iniciar el día 1:
Task T028: verificar Data Deletion Callback en Meta (BLOQUEA T030)
Task T029: coordinación de credenciales con roasify.ai
```

---

## Implementation Strategy

### MVP (US1 únicamente)

1. Completar Phase 1 (Setup): T001-T002
2. Completar Phase 2 (Foundational): T003-T007
3. Completar Phase 3 (US1): T008-T018
4. **VALIDAR**: Ejecutar Escenarios 1-5 del quickstart.md (con `META_LEAD_ADS_ENABLED=false` mientras no haya permiso de Meta — el MVP puede desplegarse así, sin riesgo, per SC-005)
5. Deploy del MVP — el sistema captura leads y los deja visibles en Twenty en cuanto se active el flag

### Entrega incremental

- **Iteración 1**: MVP (US1) — Captura + visibilidad en Twenty
- **Iteración 2**: US2 — Notificación a ventas + vínculo con Establecimientos existentes + marcado de datos incompletos → el equipo ya puede operar los leads
- **Iteración 3**: US3 — Hardening de deduplicación
- **Iteración 4**: Polish (T028-T032) — Compliance de Meta, coordinación externa y activación en producción

### Ruta crítica

La ruta crítica del proyecto NO es el código (T001-T027 son ingeniería estándar sin bloqueantes internos) sino la aprobación externa de Meta. **T028 (Data Deletion Callback) → T030 (envío del App Review)** deben iniciarse de inmediato, ya que el App Review toma 1-3 semanas y el callback puede ser un prerequisito duro para que Meta apruebe el permiso.

---

## Notes

- `[P]` = archivos diferentes y sin dependencias mutuas
- `[Story]` mapea la tarea a la historia de usuario para trazabilidad
- Mientras `META_LEAD_ADS_ENABLED=false`, todo el código de US1-US3 puede desarrollarse, probarse (con datos mockeados de la Graph API) y desplegarse sin riesgo, per FR-007/SC-005
- **T028 es prerequisito de T030**: no enviar el App Review antes de confirmar/implementar el Data Deletion Callback si Meta lo exige — su ausencia puede causar rechazo del permiso
