# Research: Integración de Meta Lead Ads con el CRM

**Feature**: 003-meta-lead-ads | **Date**: 2026-07-07

## Decisión 1: Verificación de la firma del webhook

**Decision**: Verificar `X-Hub-Signature-256` en cada request entrante usando HMAC-SHA256 sobre el body crudo con `meta_app_secret` como clave, comparando con `crypto.timingSafeEqual` (evita timing attacks). Rechazar con 403 si no coincide, sin procesar el payload.

**Rationale**: Es el mecanismo estándar de Meta para autenticar webhooks (documentado en la Graph API de Webhooks) y fue la decisión explícita tomada en `/speckit-clarify` (FR-009). Reemplaza la necesidad de `authenticateApiKey`, que no aplica porque Meta no puede enviar headers personalizados de la app.

**Alternatives considered**: No verificar firma (descartado — permite inyectar leads falsos); usar un token secreto en la URL del webhook en vez de HMAC (descartado — Meta soporta esto para el `hub.verify_token` de la suscripción inicial, pero no reemplaza la firma en cada payload subsecuente).

---

## Decisión 2: Modelo de datos — nueva tabla, no reutilizar `LeadProspect`

**Decision**: Crear un modelo nuevo (`MetaLead` en Prisma) en vez de usar el `LeadProspect` existente.

**Rationale**: `LeadProspect` (`prisma/schema.prisma:420`) exige `establishmentId` no-nulo, que referencia un establecimiento de la BD geo (DENUE). Un lead de Meta puede corresponder a un negocio que no existe en esa base — el formulario lo llena una persona, no necesariamente un establecimiento ya catalogado. Forzar ese campo obligaría a crear registros falsos en la BD geo (de solo lectura, prohibido por CLAUDE.md) o a bloquear leads legítimos sin match. Un modelo propio, con `establishmentId` opcional (se llena solo si FR-006 encuentra un match), resuelve esto sin tocar el modelo existente.

**Alternatives considered**: Extender `LeadProspect` con `establishmentId` nullable (descartado — cambiaría el contrato de un modelo ya usado por otros flujos, riesgo de regresión); usar `EstablishmentEnrichment` (descartado — esa tabla vive 1:1 con un establecimiento de la BD geo, mismo problema).

---

## Decisión 3: Cola de procesamiento — tabla propia + worker, mismo patrón que `TwentySyncJob`

**Decision**: Nueva tabla `MetaLeadJob` (o extender `TwentySyncJob` con un nuevo `type=META_LEAD_INGEST`) procesada por un worker con polling, igual que `twentySyncWorker.js`.

**Rationale**: El controller debe responder rápido (Meta espera 200 OK pronto tras el webhook, o reintenta) — la llamada a `GET /{leadgen_id}` y la lógica de matching con Establecimientos existentes no debe bloquear la respuesta HTTP. El proyecto ya resolvió este problema exacto para `INTERACTION` jobs de Twenty; reutilizar el patrón evita introducir un segundo mecanismo de colas cuando ya existe Bull + Redis y el patrón de tabla+worker funcionando en producción.

**Alternatives considered**: Extender `TwentySyncJob` en vez de tabla nueva (viable, pero el `dedupeKey`/campos de esa tabla están pensados para sync hacia Twenty específicamente; una tabla propia mantiene el dominio de "ingesta de leads externos" separado de "sincronización con Twenty", más claro para mantenimiento futuro); usar Bull directamente sin tabla en Postgres (descartado — el proyecto ya usa el patrón tabla+worker con polling para este tipo de trabajo asíncrono resiliente a reinicios, es el patrón establecido).

---

## Decisión 4: Deduplicación

**Decision**: `leadgen_id` de Meta como columna `@unique` en el modelo nuevo. Insertar con `ON CONFLICT DO NOTHING` (o `upsert` de Prisma con no-op en conflicto) al recibir la notificación del webhook, antes de encolar el job de procesamiento.

**Rationale**: Ya documentado como viable en `specs/001-crm-mejoras-marketing/research.md` (Meta Lead Ads discovery) — `leadgen_id` es único por envío de formulario. Insertar el registro crudo del webhook de forma idempotente en el momento de recibirlo (no al procesarlo) protege contra reintentos de Meta incluso si el procesamiento posterior falla.

**Alternatives considered**: Deduplicar solo en la fase de procesamiento del job (descartado — dejaría una ventana donde dos notificaciones simultáneas podrían encolar dos jobs antes de que exista el registro que detecta el duplicado).

---

## Decisión 5: Vínculo con Establecimiento existente (FR-006)

**Decision**: Buscar coincidencia por teléfono normalizado contra `EstablishmentEnrichment.decisionMakerPhone`/`decisionMakerWhatsApp`. Si hay match, vincular el lead a ese `establishmentId` (nueva actividad, no nuevo Prospecto). Si no hay match, el lead queda como registro independiente sin `establishmentId`.

**Rationale**: Decisión tomada en `/speckit-clarify`. El teléfono es el identificador más confiable disponible en ambos lados (formulario de Meta pide teléfono; el CRM ya normaliza teléfonos de contacto). Coincidencia por nombre de negocio es más ambigua (nombres similares, sin normalización) — se usa solo como señal secundaria si el teléfono no da match, no como criterio único.

**Alternatives considered**: Match solo por nombre de negocio (descartado — alta tasa de falsos positivos/negativos por variaciones de escritura); requerir revisión manual siempre (descartado explícitamente en `/speckit-clarify` a favor de vínculo automático).

---

## Decisión 6: Notificación a ventas (FR-010)

**Decision**: Reutilizar `notificationService.js` con el tipo `LEAD_NEW` ya existente (`NOTIFICATION_CONFIG.LEAD_NEW`, con envío de email incluido) — sin crear un tipo de notificación nuevo.

**Rationale**: El tipo ya existe y ya contempla título, envío de email y la integración con `emitToUser`/`emitToAdmins` vía Socket.io. No hay necesidad de duplicar esta infraestructura — cumple FR-010/SC-006 sin cambios en `notificationService.js`.

**Alternatives considered**: Crear un tipo `META_LEAD_NEW` específico (descartado por ahora — el tipo genérico `LEAD_NEW` ya cubre el caso; se puede especializar más adelante si se necesita distinguir el canal de origen en el propio tipo de notificación, pero el origen ya queda registrado en el dato del lead, no en el tipo de notificación).

---

## Decisión 7: Activación condicionada a la aprobación de Meta (FR-007)

**Decision**: Feature flag en `config/env.js` (`META_LEAD_ADS_ENABLED`, default `false`). El endpoint del webhook existe y responde 200 siempre (Meta lo requiere para mantener la suscripción activa), pero el procesamiento real (llamada a `GET /{leadgen_id}`) solo se ejecuta si el flag está en `true`. Mientras el permiso no esté aprobado, ni siquiera se debe intentar la llamada (fallaría con 403 de Meta).

**Rationale**: Permite desplegar todo el código de esta feature a producción antes de que Meta apruebe `leads_retrieval`, sin riesgo — coincide con SC-005 ("cero incidentes mientras el permiso esté pendiente") y con la recomendación ya dada de avanzar el desarrollo en paralelo a la espera de aprobación.

**Alternatives considered**: No desplegar nada hasta tener el permiso aprobado (descartado — pierde la ventana de desarrollo en paralelo ya identificada como ventaja de este proyecto).

---

## Hallazgo: Rate limits de Meta ya documentados

Reutilizar los límites ya confirmados en `specs/001-crm-mejoras-marketing/research.md`: 100 req/min, 60 registros/batch. Con un volumen bajo esperado en esta fase, no se requiere diseño adicional de rate limiting más allá de que el worker procese jobs de forma serial (mismo patrón que `twentySyncWorker.js`, que ya resuelve esto para las llamadas a Twenty).

## Hallazgo: App de Meta reutilizable de `roasify.ai`

Confirmado en `specs/001-crm-mejoras-marketing/research.md` (addendum 2026-07-07): la app `1229314395871849` ya tiene Business Verification y Access Verification aprobadas. Falta únicamente el App Review de `leads_retrieval` + `pages_manage_ads`. Las credenciales (`meta_app_id`/`meta_app_secret`) se coordinan con el operador de `roasify.ai` y se configuran de forma independiente en `config/env.js` de este proyecto — sin acceso compartido en tiempo de ejecución entre ambos proyectos.
