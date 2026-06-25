# Tasks: Mejoras CRM para Marketing — Conciliación de datos y pipeline management

**Input**: Design documents from `specs/001-crm-mejoras-marketing/`

**Prerequisites**: [plan.md](plan.md) · [spec.md](spec.md) · [data-model.md](data-model.md) · [contracts/](contracts/) · [research.md](research.md) · [quickstart.md](quickstart.md)

**Tests**: No incluidos — validación manual según [quickstart.md](quickstart.md)

**Huly issues mapeados**: CRM-847 a CRM-870 + 4 gaps del análisis (GAP-1 a GAP-4)

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Puede correr en paralelo (archivos diferentes, sin dependencias entre sí)
- **[Story]**: Historia de usuario del spec.md (US1–US5)
- **Sin [Story]**: Setup / Foundational / Polish — sin historia asociada

---

## Phase 1: Setup

**Purpose**: Sin código nuevo — el proyecto ya existe. Verificar prerequisitos manuales antes de arrancar.

- [X] T001 Verificar que el spike CRM-861 esté completo antes de continuar con Fase 6 (US3). Documentar en research.md: endpoints de Notes disponibles, rate limits, soporte de Workflows HTTP_REQUEST, formato del body de Note (markdown vs blocknote)
- [X] T002 [P] Crear los campos custom en Twenty CRM UI/Admin (prerequisito duro de T018): `ultimaCampana` (text), `fechaUltimaLlamada` (dateTime), `totalLlamadasCampana` (number) en el objeto Company. Documentar los nombres de API resultantes en `specs/001-crm-mejoras-marketing/research.md`

**Checkpoint**: T001 confirma que la API de Twenty soporta Notes. T002 asegura que los campos existen antes de cualquier deploy de código que los escriba.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Infraestructura de jobs INTERACTION. NADA de lo que sigue puede implementarse sin esta fase.

**Corresponde a**: CRM-846, CRM-847, CRM-848, CRM-849

**⚠️ CRÍTICO**: Ninguna historia de usuario puede comenzar hasta que esta fase esté completa.

- [X] T003 Migración Prisma en `prisma/schema.prisma`: agregar a `TwentySyncJob` los campos `type TwentySyncJobType @default(PIPELINE)`, `payload Json?`, `dedupeKey String? @unique`, `maxAttempts Int?`; agregar nuevo índice `@@index([type, status, nextRunAt])`; agregar enum `TwentySyncJobType { PIPELINE INTERACTION }` (CRM-847)
- [X] T004 Ejecutar `npm run db:migrate:dev` con nombre de migración `add_interaction_type_to_twenty_sync_job` y verificar que los jobs existentes conservan `type=PIPELINE` por default; ejecutar `npm run db:generate` (CRM-847)
- [X] T005 [P] Agregar método `async createNote(title, bodyMarkdown)` en `src/services/twenty/twentyService.js` siguiendo el patrón del cliente axios existente: `POST /notes`, manejo de errores con contexto, log estructurado `[TwentyService:createNote]` (CRM-848)
- [X] T006 [P] Agregar método `async createNoteTarget(noteId, { companyId })` en `src/services/twenty/twentyService.js`: `POST /noteTargets`, verificar en staging que la Note queda visible en el timeline del Company (CRM-848)
- [X] T007 Crear `src/services/twenty/twentyActivityService.js` con: constante `STAGE_CONFIG` (discovery, qualification, activation, conversion, coupon_sent, coupon_redeemed), función `enqueueInteractionSync({ establishmentId, conversationId, stage, outcome, callSummary, callDuration, campaignId, campaignName })` con dedupeKey `interaction:{conversationId}:{stage}` y captura de P2002 como skip; función `processInteractionJob(job)` que resuelve `twentyEstablecimientoId`, crea Note con plantilla markdown definida en `data-model.md`, ancla al Company vía `createNoteTarget` (CRM-849)
- [X] T008 Modificar `src/services/twenty/twentySyncService.js` función `enqueueSync`: preservar lógica de colapso (un solo PENDING por establishment) **solo para type PIPELINE** — no colapsar si hay jobs INTERACTION pendientes para el mismo establishment (CRM-847)
- [X] T009 Modificar `src/workers/twentySyncWorker.js`: importar `twentyActivityService`; en `processPendingJobs`, bifurcar por `job.type`: `PIPELINE` → flujo actual sin cambios; `INTERACTION` → `processInteractionJob(job)` del nuevo servicio (CRM-849)

**Checkpoint**: Foundational completa cuando: (a) la migración está aplicada, (b) se puede crear una Note manualmente vía script llamando `createNote`/`createNoteTarget`, y (c) el worker procesa un job INTERACTION de prueba sin errores.

---

## Phase 3: User Story 1 — Historial completo de interacciones por lead (Priority: P1) 🎯 MVP

**Goal**: Cada llamada de campaña (exitosa o fallida) genera automáticamente una Note en el Company de Twenty, sin intervención manual. Incluye deduplicación ante reintentos.

**Independent Test**: Ejecutar una llamada de campaña Discovery en staging → verificar Note en Company de Twenty en < 5 minutos. Ver [quickstart.md Escenario 1](quickstart.md).

**Corresponde a**: CRM-850, CRM-851, CRM-852

- [X] T010 [US1] Crear helper `enqueueCampaignSync(stage, { conversationId, establishmentId, outcome, callSummary, callDuration, campaignId, campaignName })` en `src/services/funnelWebhookService.js` (o archivo utils separado): llama `enqueueSync` + `enqueueInteractionSync` de forma non-blocking (fire-and-forget con `.catch(logger.error)`) (CRM-851)
- [X] T011 [US1] Agregar hook non-blocking al final de `endDiscoveryCall` (línea ~398 en `src/services/funnelWebhookService.js`): llamar `enqueueCampaignSync('discovery', { ... })` junto al `syncCampaignContactStatus` existente (CRM-851)
- [X] T012 [P] [US1] Agregar hook non-blocking al final de `endQualificationCall` (línea ~1239 en `src/services/funnelWebhookService.js`): llamar `enqueueCampaignSync('qualification', { ... })` (CRM-851)
- [X] T013 [P] [US1] Agregar hook non-blocking al final de `endActivationCall` (línea ~664 en `src/services/funnelWebhookService.js`): llamar `enqueueCampaignSync('activation', { ... })` (CRM-851)
- [X] T014 [P] [US1] Agregar hook non-blocking al final de `endConversionCall` (línea ~1558 en `src/services/funnelWebhookService.js`): llamar `enqueueCampaignSync('conversion', { ... })` (CRM-851)
- [ ] T015 [US1] Agregar fallback en `src/controllers/campaignWebhookController.js` función `handleElevenLabsWebhook` (línea ~574): tras actualizar `CampaignContact`, si outcome es `FAILED`, `NO_ANSWER` o `VOICEMAIL`, llamar `enqueueInteractionSync` de forma non-blocking con `dedupeKey interaction:{conversationId}:{stage}` para que el duplicado del camino MCP sea ignorado automáticamente (CRM-852)
- [ ] T016 [US1] **GAP-1**: Agregar manejo de Company inexistente en Twenty dentro de `processInteractionJob` en `src/services/twenty/twentyActivityService.js`: si `TwentySyncState` existe pero `twentyEstablecimientoId` es null (Company borrado en Twenty), log error con contexto suficiente + skip de la Note (no lanzar error no manejado); documentar el escenario en el criterio de aceptación de CRM-853

**Checkpoint**: US1 completa cuando los 7 escenarios del [quickstart.md](quickstart.md) pasan (especialmente escenarios 1, 2, 3, 4, 5).

---

## Phase 4: User Story 2 — Estado del pipeline filtrable por campaña (Priority: P1)

**Goal**: El perfil de cada establecimiento en Twenty muestra `ultimaCampana`, `fechaUltimaLlamada` y `totalLlamadasCampana`, y estos campos son filtrables en vistas.

**Independent Test**: Abrir Company en Twenty tras una llamada → verificar los 3 campos actualizados. Crear filtro por `fechaUltimaLlamada` en vista de Companies → verificar que filtra correctamente. Ver [quickstart.md Escenario 7](quickstart.md).

**Prerequisito**: T002 (campos custom creados en Twenty) debe estar completo antes del deploy de T018.

**Corresponde a**: CRM-854, CRM-855, CRM-856

- [ ] T017 [US2] Agregar método `async updateCompanyFields(companyId, { ultimaCampana, fechaUltimaLlamada, totalLlamadasCampana })` en `src/services/twenty/twentyService.js`: `PATCH /companies/{companyId}`, usando los nombres de API documentados en T002 (CRM-856)
- [ ] T018 [US2] Modificar `processInteractionJob` en `src/services/twenty/twentyActivityService.js`: tras crear la Note y el NoteTarget, calcular `totalLlamadasCampana` como COUNT de jobs INTERACTION con status DONE para el `establishmentId` (no "+1 ciego"), actualizar `fechaUltimaLlamada` solo si el timestamp de la llamada actual es más reciente que el campo existente, llamar `updateCompanyFields` con los 3 valores (CRM-856)
- [ ] T019 [US2] **GAP-2**: Agregar verificación de existencia de campos custom al arranque del worker o al primer intento de escritura en `twentyActivityService.js`: si los campos no existen en la respuesta de la API de Twenty, loggear error visible `[TwentyActivityService:updateCompanyFields] Campo custom inexistente en Twenty — verificar CRM-855` y continuar sin romper el flujo (smoke test de campos)

**Checkpoint**: US2 completa cuando: Company muestra los 3 campos tras una llamada, el contador no duplica en reintentos, y `fechaUltimaLlamada` no retrocede.

---

## Phase 5: US1 Extensión — Cupones + Backfill histórico (Priority: Low)

**Goal**: Completar el historial: cupones como Notes + llamadas históricas previas al deploy visibles en Twenty.

**Independent Test**: Enviar un cupón → Note "Cupón enviado" en Company. Correr backfill dry-run → reporte de volumen sin duplicados. Ver [quickstart.md Escenario 6](quickstart.md).

**Corresponde a**: CRM-857, CRM-858, CRM-859

- [ ] T020 [P] [US1] Agregar entradas `coupon_sent` y `coupon_redeemed` en `STAGE_CONFIG` dentro de `src/services/twenty/twentyActivityService.js` con sus `stageLabel`, `outcomeLabels` y `isConversational = () => false` (CRM-858)
- [ ] T021 [P] [US1] Agregar hook non-blocking en `src/services/couponWhatsappService.js` en el punto de éxito de envío: llamar `enqueueInteractionSync` con `stage='coupon_sent'`, `conversationId=couponId`, `dedupeKey coupon:{couponId}:sent` (CRM-858)
- [ ] T022 [P] [US1] Agregar hook non-blocking en `src/services/couponGeneratorService.js` en el punto de redención exitosa: llamar `enqueueInteractionSync` con `stage='coupon_redeemed'`, `dedupeKey coupon:{couponId}:redeemed` (CRM-858)
- [ ] T023 [US1] Crear `prisma/scripts/backfill-interactions.js`: recorrer `CampaignContact` históricos con `conversationId` no nulo, encolar jobs INTERACTION con su dedupeKey natural; modo `--dry-run` que solo reporta sin encolar; procesamiento por lotes de 50 con delay configurable entre lotes; reporte final: encoladas / saltadas por duplicado / sin establecimiento mapeable (CRM-859)

**Checkpoint**: US1 extensión completa cuando: dry-run reporta volumen correcto, ejecución real encola sin duplicar, re-ejecución muestra 0 nuevas encoladas.

---

## Phase 6: User Story 3 — Automatización de seguimientos (Priority: P2)

**Goal**: Marketing configura reglas en Twenty que disparan acciones automáticas (tareas, re-campañas) basadas en campos de campaña.

**Prerequisito duro**: T001 (spike CRM-862) debe estar completo y confirmar que Twenty soporta Workflows con HTTP_REQUEST.

**Independent Test**: Configurar regla `fechaUltimaLlamada > 30 días + nivel=PROSPECT` → crear tarea automática. Verificar sin intervención manual. Ver spec US3 escenario 1.

**Corresponde a**: CRM-860, CRM-861, CRM-862, CRM-863, CRM-864, CRM-865, CRM-866, CRM-867

- [ ] T024 [US3] Crear `src/routes/crmHooksRoutes.js`: montar `POST /api/v1/crm-hooks` con middleware `authenticateApiKey`; registrar en `src/app.js` (CRM-863)
- [ ] T025 [US3] Crear `src/controllers/crmHooksController.js`: validar body con Zod `z.object({ action: z.string(), payload: z.object({ establishmentId: z.string() }), source: z.string().optional(), correlationId: z.string().optional() })`; mapa de acciones `{ 'send-whatsapp': ..., 'requeue-campaign': ... }`, respuesta 422 para acciones desconocidas, respuesta asíncrona para acciones de larga duración; log estructurado con `source` y `correlationId` (CRM-864)
- [ ] T026 [US3] **GAP-4**: Verificar que `authenticateApiKey` en `src/middleware/auth.js` rechaza con 401 cualquier request sin x-api-key válida al nuevo endpoint; documentar en `contracts/crm-hooks.md` el ejemplo curl de prueba
- [ ] T027 [US3] Sesión con marketing (no técnica): definir y documentar las reglas de automatización concretas que se configurarán en Twenty (condiciones, acciones, frecuencia) — output: lista de reglas en `research.md` (CRM-866)
- [ ] T028 [US3] Configurar en Twenty: Workflows según reglas definidas en T027, kanban de Opportunity, vistas compartidas para el equipo de ventas y marketing (CRM-867)

**Checkpoint**: US3 completa cuando: el endpoint `/crm-hooks` responde 200/401/422 correctamente, y al menos 2 automatizaciones están configuradas y probadas en staging.

---

## Phase 7: User Story 4 — Colaboración del equipo (Priority: P2)

**Goal**: Roles diferenciados en Twenty: Marketing lee todo + edita solo sus campos; Ventas edita todo; Administrador configura.

**Independent Test**: Usuario con rol Marketing puede ver Company y dejar comentario; no puede modificar el campo `level` del establecimiento. Ver spec US4 escenario 1.

**Corresponde a**: CRM-868, CRM-869

- [ ] T029 [US4] Configurar roles RBAC en Twenty: crear roles `Administrador`, `Ventas`, `Marketing`, `Solo lectura`; definir permisos — Marketing: lectura total + edición de campos propios (comentarios, etiquetas); Ventas: edición completa; registrar convenciones en `research.md` (CRM-869)
- [ ] T030 [P] [US4] Crear vistas compartidas en Twenty para el equipo de marketing: vista "Pipeline activo" filtrada por `totalLlamadasCampana > 0` y "Sin contacto reciente" filtrada por `fechaUltimaLlamada` hace más de 30 días (CRM-867 — vistas compartidas; complementa Workflows de T028)
- [ ] T031 [US4] Capacitación del equipo de marketing: sesión con guía de uso del pipeline, vistas compartidas, uso de comentarios y comprensión de permisos; verificar adopción autónoma a los 15 días (CRM-869)

**Checkpoint**: US4 completa cuando el equipo de marketing puede operar el pipeline sin asistencia técnica.

---

## Phase 8: User Story 5 — Ingesta de leads desde Meta / Manychat (Priority: P3 — Discovery)

**Goal**: Discovery técnico: determinar factibilidad e identificar requisitos de integración con Meta Lead Ads y Manychat.

**Independent Test**: Documento de discovery con API endpoints, requisitos de permisos, volumen estimado, y decisión go/no-go.

**Corresponde a**: CRM-870

- [ ] T032 [US5] Discovery técnico Meta Lead Ads: investigar Webhooks API de Meta, requisitos de permisos (Business Manager, app review), formato de payload, mecanismo de deduplicación posible; documentar hallazgos en `research.md` sección "Meta Lead Ads discovery" (CRM-870)
- [ ] T033 [P] [US5] Discovery técnico Manychat: investigar API de Manychat para extracción de contactos, triggers disponibles, formato de datos, autenticación requerida; documentar en `research.md` sección "Manychat discovery" (CRM-870)
- [ ] T034 [US5] Decisión go/no-go basada en T032 y T033: si viable, crear nuevo spec independiente para la integración con alcance, datos de entidad, deduplicación multi-canal (FR-017) y estimación de esfuerzo

**Checkpoint**: US5 (Discovery) completa cuando el documento de decisión go/no-go está disponible para el equipo de producto.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Gaps identificados en el análisis + documentación final.

- [ ] T035 [P] Validación E2E completa según [quickstart.md](quickstart.md): ejecutar los 7 escenarios en staging y registrar evidencia (capturas / IDs de jobs) — esto es el criterio de aceptación de CRM-853
- [ ] T036 [P] Actualizar `specs/001-crm-mejoras-marketing/research.md` con: nombres de API de los campos custom de Twenty (post T002), rate limits confirmados, formato de body de Note confirmado
- [ ] T037 Revisar CRM-853 en Huly para agregar escenario explícito: "Establecimiento sin TwentySyncState previo — el sistema crea Company y ancla la Note" (acción en Huly, no en código)
- [ ] T038 Revisar CRM-864 en Huly para agregar criterio de aceptación de autenticación explícita en `/crm-hooks` (GAP-4 — acción en Huly)

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup / prerequisitos manuales)
    │
    ├── T001 (spike) — BLOQUEA Phase 6 (US3)
    └── T002 (campos custom) — BLOQUEA T017/T018 (US2)
         │
Phase 2 (Foundational — T003–T009)
    │ BLOQUEA TODAS LAS FASES SIGUIENTES
    ▼
Phase 3 (US1: Historial — T010–T016)    ← Puede iniciar al completar Phase 2
Phase 4 (US2: Pipeline — T017–T019)     ← Puede correr en paralelo con Phase 3
Phase 5 (US1 ext: Cupones/Backfill — T020–T023) ← Depende de Phase 3
Phase 6 (US3: Automatización — T024–T028) ← Depende de T001 + Phase 4
Phase 7 (US4: Colaboración — T029–T031) ← Puede iniciar al completar Phase 4
Phase 8 (US5: Discovery — T032–T034)   ← Independiente, puede correr en cualquier momento
Phase 9 (Polish — T035–T038)           ← Al completar Phase 3 y 4
```

### User Story Dependencies

- **US1 (P1)**: Depende solo de Phase 2 (Foundational). Puede iniciar de inmediato tras T003-T009.
- **US2 (P1)**: Depende de Phase 2 + T002 (campos custom en Twenty). Puede correr en paralelo con US1.
- **US3 (P2)**: Depende de T001 (spike confirma Workflows de Twenty) + Phase 4 (US2 completa, para que las condiciones de automatización tengan datos).
- **US4 (P2)**: Depende de Phase 4 (US2 completa, para que las vistas sean útiles). Puede correr en paralelo con US3.
- **US5 (P3)**: Discovery independiente — puede hacerse en cualquier momento.

### Orden dentro de cada fase

- Phase 2: T003 → T004 (migración primero, luego db:generate) → T005, T006 [paralelo] → T007 → T008, T009 [paralelo con T008]
- Phase 3: T010 (helper) → T011, T012, T013, T014 [paralelo entre sí] → T015 → T016
- Phase 4: T017 → T018 → T019
- Phase 5: T020, T021, T022 [paralelo] → T023
- Phase 6: T024 → T025 → T026 → T027 → T028 (T027 puede hacerse en paralelo con T024-T026)

---

## Parallel Opportunities

```bash
# Phase 2 — tras migración (T003-T004):
Task T005: createNote() en twentyService.js
Task T006: createNoteTarget() en twentyService.js
# Ambos son métodos independientes del mismo archivo — coordinar para no conflicto de merge

# Phase 3 — tras crear helper T010:
Task T012: hook endQualificationCall
Task T013: hook endActivationCall
Task T014: hook endConversionCall
# Los 3 son cambios en funnelWebhookService.js en líneas distintas

# Phase 5:
Task T020: STAGE_CONFIG cupones
Task T021: hook couponWhatsappService
Task T022: hook couponGeneratorService
# Archivos diferentes, sin dependencias entre sí

# Phase 8 — completamente independiente:
Task T032: Discovery Meta Lead Ads
Task T033: Discovery Manychat
```

---

## Implementation Strategy

### MVP (US1 + US2 únicamente)

1. Completar Phase 1 (prerequisitos manuales): T001 + T002
2. Completar Phase 2 (Foundational): T003–T009
3. Completar Phase 3 (US1): T010–T016
4. Completar Phase 4 (US2): T017–T019
5. **VALIDAR**: Ejecutar escenarios 1–5 + 7 del quickstart.md en staging
6. Deploy del MVP — marketing ya puede ver historial de llamadas en Twenty

### Entrega incremental

- **Iteración 1**: MVP (US1 + US2) — Historial + Pipeline → Marketing ve datos de campañas en CRM
- **Iteración 2**: US1 ext (Phase 5) — Cupones + Backfill → Timeline completo incluye cupones e historial previo
- **Iteración 3**: US3 + US4 (Phase 6 + 7) — Automatizaciones + Colaboración → Marketing puede actuar sobre los datos
- **Iteración 4**: US5 (Phase 8 + decisión go/no-go) — Integraciones externas si es viable

---

## Notes

- `[P]` = archivos diferentes y sin dependencias mutuas — pueden asignarse a personas distintas
- `[Story]` mapea la tarea a la historia de usuario para trazabilidad
- Los hooks en `funnelWebhookService.js` (T011–T014) modifican líneas distintas del mismo archivo — coordinar para evitar conflictos de merge
- **Orden de deploy crítico**: T002 (campos custom en Twenty) DEBE deployarse antes de T017/T018 en producción
- Los issues de Huly existentes (CRM-847 a CRM-870) mapean 1:1 con los grupos de tareas — no duplicar trabajo
- GAP-1 (T016), GAP-2 (T019), GAP-4 (T026, T038) son mejoras de robustez identificadas en el análisis y no tienen issue en Huly aún
