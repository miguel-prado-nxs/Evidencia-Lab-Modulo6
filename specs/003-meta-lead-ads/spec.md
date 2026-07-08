# Feature Specification: Integración de Meta Lead Ads con el CRM

**Feature Branch**: `003-meta-lead-ads`

**Created**: 2026-07-07

**Status**: Draft

**Input**: User description: "Integración de Meta Lead Ads con el CRM — captar leads de formularios de Facebook/Instagram Ads vía webhook y llevarlos al pipeline de Establecimientos/Prospectos en Twenty, con deduplicación por leadgen_id. Contexto: decisión GO tomada en specs/001-crm-mejoras-marketing (T032/T034); reutiliza la App de Meta de roasify.ai (Business Verification y Tech Provider ya aprobados), pendiente App Review de leads_retrieval + pages_manage_ads. Manychat queda fuera de alcance por ahora (pospuesto por decisión de negocio)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Captura automática de leads desde formularios de Meta Ads (Priority: P1)

Un restaurantero ve un anuncio de EasyOrder en Facebook o Instagram, llena el formulario de contacto ("quiero información") y, sin que nadie del equipo intervenga manualmente, ese lead aparece en el sistema con sus datos de contacto (nombre, teléfono, negocio si lo indicó) listo para que ventas o el flujo de llamadas le dé seguimiento.

**Why this priority**: Es el problema central que motiva la integración — hoy estos leads no llegan a ningún lado automatizado y se pierden o dependen de que alguien revise Meta Ads Manager manualmente. Sin esta historia no hay valor de negocio.

**Independent Test**: Enviar un lead de prueba a través de un formulario de Meta Lead Ads conectado y verificar que aparece un nuevo registro **visible en Twenty** (el CRM que usa el equipo) en menos de 5 minutos, con los datos capturados en el formulario. La visibilidad en Twenty es parte del MVP — no basta con persistir el lead solo en la BD interna de Partners API.

**Acceptance Scenarios**:

1. **Given** una Page de Facebook conectada con un formulario de Lead Ads activo, **When** un usuario llena y envía el formulario, **Then** se crea un registro de lead en el CRM con nombre, teléfono/email y el formulario de origen, sin intervención manual.
2. **Given** un lead ya capturado exitosamente, **When** se consulta el registro en el CRM, **Then** se puede ver de qué anuncio/formulario/página provino.

---

### User Story 2 - Enrutamiento del lead hacia el proceso de ventas (Priority: P2)

Una vez capturado, el lead debe quedar visible y accionable para el equipo correspondiente (ventas o el flujo de llamadas), en el mismo lugar donde ya se gestionan los demás establecimientos/prospectos, sin que el equipo tenga que revisar un sistema aparte.

**Why this priority**: Capturar el lead sin que nadie le dé seguimiento no genera valor — esta historia es la que convierte la captura en una oportunidad de venta real.

**Independent Test**: Tras la captura de un lead (US1), verificar que aparece en la vista/kanban de Prospectos con estado inicial claro, y que un miembro del equipo puede identificarlo como originado por Meta Ads.

**Acceptance Scenarios**:

1. **Given** un lead recién capturado desde Meta, **When** el equipo de ventas revisa el pipeline de Prospectos, **Then** el lead aparece con su origen marcado como "Meta Ads" y con la información de contacto disponible para actuar.
2. **Given** un lead sin teléfono válido en el formulario, **When** se intenta enrutarlo, **Then** el sistema lo marca como "dato incompleto" en vez de fallar silenciosamente.
3. **Given** un lead nuevo capturado exitosamente, **When** se crea el registro, **Then** el equipo de ventas recibe una notificación activa (mismo canal que ya usa el CRM para alertas) sin tener que estar revisando la vista de Prospectos por su cuenta.

---

### User Story 3 - Deduplicación de leads repetidos (Priority: P3)

Si Meta reenvía la misma notificación de webhook (reintento de red) o el mismo usuario llena el formulario más de una vez, el sistema no debe crear registros duplicados del mismo lead.

**Why this priority**: Sin deduplicación, el equipo vería el mismo prospecto varias veces, generando confusión y posible doble contacto — pero el sistema sigue siendo funcional sin esto en el camino feliz, por lo que es de menor prioridad que US1/US2.

**Independent Test**: Enviar la misma notificación de webhook dos veces (mismo identificador de lead) y verificar que solo existe un registro en el CRM.

**Acceptance Scenarios**:

1. **Given** un lead ya capturado con un identificador específico, **When** llega una segunda notificación con el mismo identificador, **Then** el sistema no crea un registro nuevo ni duplica la notificación al equipo.
2. **Given** dos leads distintos del mismo número de teléfono en formularios diferentes, **When** se procesan, **Then** el sistema los distingue por su identificador único de lead, no por teléfono (evita fusionar leads legítimamente distintos).

---

### Edge Cases

- ¿Qué pasa si Meta envía la notificación del webhook pero al momento de consultar los datos completos del lead la API de Meta no responde o da error? El sistema debe reintentar sin perder la notificación original.
- ¿Qué pasa si el permiso de Meta (`leads_retrieval`) todavía no ha sido aprobado cuando se despliega esta funcionalidad? El endpoint debe poder existir y quedar inactivo/sin tráfico real hasta que la aprobación llegue, sin romper nada del sistema existente.
- ¿Qué pasa si un formulario de Meta no tiene mapeo definido hacia ninguna oferta/campaña conocida? El lead se debe capturar igual, marcado como "sin clasificar", en vez de descartarse.
- ¿Qué pasa si el token de acceso de la Page conectada expira o se revoca? El sistema debe detectar la falla de forma visible (no silenciosa) para que alguien reconecte la cuenta.
- ¿Qué pasa si el mismo negocio ya existe como Establecimiento en el CRM (por ejemplo, ya fue contactado por una campaña de llamadas) y ahora también llega como lead de Meta? El sistema vincula el lead automáticamente a ese Establecimiento existente (nueva actividad/nota), en vez de crear un Prospecto duplicado.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema MUST recibir notificaciones en tiempo real cuando un usuario completa un formulario de Lead Ads en una Page de Facebook/Instagram conectada.
- **FR-002**: El sistema MUST obtener los datos completos del lead (nombre, teléfono, email, respuestas del formulario) a partir del identificador recibido en la notificación.
- **FR-003**: El sistema MUST crear un registro de lead visible en el pipeline de Prospectos del CRM, con su origen marcado como "Meta Ads" y trazabilidad hacia el formulario/anuncio/página de origen.
- **FR-004**: El sistema MUST deduplicar leads usando el identificador único que Meta asigna a cada envío de formulario, de forma que un reintento de notificación o un envío duplicado no genere registros repetidos.
- **FR-005**: El sistema MUST manejar de forma explícita (sin fallo silencioso) los casos de datos incompletos, token expirado, o error al consultar la API de Meta — dejando evidencia registrada (logs) para diagnóstico.
- **FR-006**: El sistema MUST identificar si un lead corresponde a un negocio que ya existe como Establecimiento en el CRM **usando el teléfono normalizado como único criterio de match** y, en ese caso, vincular el lead automáticamente a ese Establecimiento en vez de crear un Prospecto nuevo y separado. El nombre de negocio NO se usa como criterio de match (ambiguo, propenso a falsos positivos).
- **FR-007**: El sistema MUST quedar deshabilitado de forma segura (sin generar errores) mientras el permiso `leads_retrieval` de Meta no haya sido aprobado — la funcionalidad se activa sin requerir cambios de código una vez aprobado el permiso.
- **FR-008**: Sales/marketing MUST ser capaz de ver, para cada lead capturado, de qué formulario y página de Meta provino, sin necesidad de acceder a Meta Ads Manager.
- **FR-009**: El sistema MUST verificar la firma criptográfica que Meta incluye en cada notificación de webhook, rechazando y descartando sin procesar cualquier notificación cuya firma no sea válida.
- **FR-010**: El sistema MUST notificar activamente al equipo de ventas/marketing (mismo canal de notificaciones ya existente en el CRM) cuando se crea un lead nuevo desde Meta, en vez de depender de que alguien revise la vista de Prospectos por su cuenta.
- **FR-011**: Antes de enviar el App Review de `leads_retrieval` a Meta, se MUST verificar en el App Dashboard si Meta exige un mecanismo de eliminación de datos (Data Deletion Callback o URL pública de instrucciones de eliminación). Si es requerido, ese mecanismo MUST implementarse/publicarse como parte del alcance, previo al envío del permiso — no puede quedar como supuesto descartado, ya que su ausencia puede bloquear la aprobación (ruta crítica del proyecto).

### Key Entities *(include if feature involves data)*

- **Meta Lead Webhook Event**: Notificación cruda recibida de Meta (identificador de lead, page, formulario, anuncio, timestamp). Se usa como fuente de verdad para deduplicación y auditoría.
- **Lead capturado**: Entidad normalizada resultante — datos de contacto del lead, formulario/anuncio de origen, estado de procesamiento (capturado / dato incompleto / vinculado a establecimiento existente). Vive en el mismo pipeline de Prospectos que usan los demás canales de captación.
- **Conexión de Página de Meta**: Representa la Page/formulario habilitados para recibir leads — incluye el estado de la conexión (activa / token expirado / desconectada).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un lead enviado desde un formulario de Meta Ads aparece en el CRM en menos de 5 minutos, sin intervención manual.
- **SC-002**: 0% de leads duplicados en el CRM ante reintentos de notificación de Meta (mismo lead, misma notificación repetida).
- **SC-003**: El equipo de ventas puede identificar el origen ("Meta Ads") de un lead directamente en el CRM, sin consultar ningún sistema externo, en el 100% de los casos capturados.
- **SC-004**: Los leads con datos de contacto incompletos quedan marcados como tales en el 100% de los casos, en vez de perderse o generar un error visible al usuario final.
- **SC-005**: Cero incidentes en producción atribuibles a esta funcionalidad mientras el permiso de Meta esté pendiente de aprobación (la funcionalidad puede desplegarse inactiva sin riesgo).
- **SC-006**: El equipo de ventas recibe una notificación por cada lead nuevo capturado en menos de 1 minuto desde su creación en el CRM, sin necesidad de revisar la vista de Prospectos de forma proactiva.

## Assumptions

- El lead capturado se integra al mismo pipeline de Prospectos/Establecimientos ya existente en el CRM (Twenty), reutilizando los mismos conceptos de etapa y seguimiento que usan los leads generados por las campañas de llamadas — no se crea un pipeline paralelo.
- La app de Meta a reutilizar (`roasify.ai`, Business Verification y Tech Provider ya aprobados) queda disponible para este propósito mediante coordinación entre equipos; las credenciales se configuran de forma independiente en este proyecto (`config/env.js`), sin dependencia técnica en tiempo de ejecución hacia el proyecto roasify.ai.
- El alcance de esta fase es un solo canal (Meta Lead Ads) — Manychat queda explícitamente fuera de alcance por decisión de negocio (ver `specs/001-crm-mejoras-marketing`, T034), por lo que la deduplicación multi-canal (FR-017 del spec anterior) no aplica todavía; el mecanismo de deduplicación aquí es de un solo canal.
- Mientras el permiso `leads_retrieval` de Meta esté pendiente de aprobación, el desarrollo puede avanzar y probarse con datos simulados; la activación con datos reales queda gated por esa aprobación externa.
- Retención y manejo de los datos personales del lead sigue las mismas prácticas ya establecidas para datos de contacto en el CRM (`EstablishmentEnrichment`). **Excepción a verificar (FR-011)**: Meta puede exigir un Data Deletion Callback como requisito de App Review para `leads_retrieval` — esto se confirma en el App Dashboard antes de enviar el permiso y, si aplica, se implementa como parte del alcance.

## Clarifications

### Session 2026-07-07

- Q: Cuando llega un lead nuevo capturado, ¿el sistema debe inscribirlo automáticamente en una campaña de llamadas de Discovery (mismo flujo que un establecimiento prospectado), o solo debe crearlo como Prospecto visible para que ventas decida manualmente el siguiente paso? → A: Solo crear el Prospecto visible; el enrutamiento a una campaña de llamadas queda como decisión manual del equipo de ventas en esta fase, para no automatizar el primer contacto igual que se decidió pausar con Manychat.
- Q: ¿El alcance cubre una sola Page/cuenta publicitaria de Meta (la oficial de EasyOrder), o debe soportar múltiples páginas/cuentas desde el inicio? → A: Una sola Page/cuenta en esta fase — soportar múltiples páginas queda fuera de alcance hasta que haya una necesidad de negocio concreta.
- Q: ¿El sistema debe verificar la firma criptográfica de Meta en cada notificación de webhook antes de procesarla? → A: Sí — verificar la firma HMAC (X-Hub-Signature-256) en cada notificación y rechazar las que no coincidan con el secreto de la app, para evitar leads falsos inyectados por terceros.
- Q: Cuando un lead de Meta coincide con un Establecimiento que ya existe en el CRM, ¿qué debe pasar? → A: Vincular el lead automáticamente al Establecimiento existente (nueva actividad/nota), sin crear un Prospecto nuevo y separado.
- Q: Cuando se crea un lead nuevo desde Meta, ¿el equipo de ventas debe recibir una notificación activa o solo descubrirlo al revisar la vista de Prospectos? → A: Notificación activa, usando el mismo canal de notificaciones ya existente en el CRM.
- Q: ¿Qué debe incluir el MVP (US1) para considerarse "lead visible en el CRM"? → A: El MVP incluye el sync a Twenty — capturar el lead Y hacerlo visible en Twenty. US2 solo agrega notificación activa + vínculo con Establecimiento existente.
- Q: ¿Cómo se maneja el requisito de eliminación de datos (Data Deletion) que Meta puede exigir para leads_retrieval? → A: Verificar el requisito en el App Dashboard antes del App Review; si Meta lo exige, implementarlo/publicarlo como parte del alcance previo al envío del permiso (FR-011).
- Q: ¿Por qué criterio debe hacerse el match de un lead con un Establecimiento existente? → A: Solo por teléfono normalizado; el nombre de negocio no se usa como criterio de match (FR-006 acotado).
