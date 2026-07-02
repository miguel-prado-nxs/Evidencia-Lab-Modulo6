# Feature Specification: Mejoras CRM para Marketing — Conciliación de datos y pipeline management

**Feature Branch**: `001-crm-mejoras-marketing`

**Created**: 2026-06-18

**Status**: Draft

**Input**: Análisis comparativo EasyOrder Leads vs Attio entregado por marketing. El documento identifica 4 áreas de mejora para el CRM (Twenty): automatización de flujos, pipeline management e historial de actividad por lead, colaboración en tiempo real, e integraciones con WhatsApp/Meta/Manychat. Este spec consolida los requerimientos de las épicas CRM-845 y CRM-860 del backlog, valida su completitud y documenta gaps identificados.

---

## Contexto del análisis

Marketing comparó EasyOrder Leads con Attio y solicitó que el CRM (Twenty) incorpore:

1. **Automatización de flujos**: disparar acciones, recordatorios y actualizaciones según reglas, eventos y condiciones del pipeline.
2. **Pipeline management / Historial de actividad por lead**: visualizar etapas, pronósticos y cuellos de botella para acelerar el ciclo de ventas.
3. **Colaboración en tiempo real**: vistas compartidas, comentarios y permisos para alinear ventas, marketing y éxito del cliente.
4. **Integraciones**: WhatsApp, Meta Lead Ads, Manychat — mantener registros siempre actualizados.

### Cobertura de issues existentes vs requerimientos del PDF

| Requerimiento marketing | Issues existentes | Estado |
|---|---|---|
| Historial de actividad por lead | CRM-845 (épica), CRM-846–859 | Bien cubierto |
| Pipeline management (campos planos) | CRM-854, CRM-855, CRM-856 | Bien cubierto |
| Automatización de flujos | CRM-860, CRM-865–867 | Parcialmente — reglas aún TBD |
| Colaboración / permisos / vistas | CRM-868, CRM-869 | Correcto, acotado a Twenty nativo |
| Integraciones Meta / Manychat | CRM-870 | Solo Discovery — correcto para esta etapa |
| Deduplicación de leads multi-canal | No existe issue | **GAP** |
| Edge: Company eliminado en Twenty | No existe issue | **GAP** |
| Smoke test de campos antes de deploy | No existe issue | **GAP menor** |

---

## Clarifications

### Session 2026-06-18

- Q: ¿Qué garantía de entrega debe tener el sync de interacciones hacia Twenty cuando la API falla repetidamente? → A: **Diferenciado** — llamadas completadas (con conversación real) reintentan sin límite hasta garantizar entrega; llamadas no conversacionales (FAILED, NO_ANSWER, VOICEMAIL) aplican best effort con máximo 5 reintentos con backoff exponencial.
- Q: ¿Qué alcance debe tener el backfill histórico de interacciones (FR-006)? → A: **Todo el historial** — todas las interacciones desde el inicio de las campañas, sin corte de fecha; el dedupeKey garantiza idempotencia ante múltiples ejecuciones.
- Q: ¿Qué nivel de acceso debe tener el rol Marketing sobre registros en Twenty (FR-013)? → A: **Lectura + edición propia** — Marketing lee todos los campos del Company; puede editar solo campos de su área (comentarios, etiquetas de segmentación); no puede modificar campos operativos (nivel, etapa de campaña, datos de contacto de ventas).

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Historial completo de interacciones por lead (Priority: P1)

Un integrante de marketing o ventas abre el perfil de un establecimiento en el CRM y puede ver de forma cronológica TODAS las interacciones: llamadas de campaña (con etapa, resultado y resumen), cupones enviados y canjeados, y el nivel de avance en el funnel. Puede entender el contexto completo antes de tomar una decisión sin consultar sistemas externos.

**Why this priority**: Es el prerequisito de todo lo demás. Sin datos confiables en el CRM no hay automatizaciones ni pipeline management posibles. Es el núcleo del pedido "Pipeline management / Historial de actividad por lead" del análisis de marketing.

**Independent Test**: Ejecutar una llamada de campaña en staging y verificar que aparece como nota cronológica en el Company correspondiente en Twenty, con etapa, resultado y resumen visibles.

**Acceptance Scenarios**:

1. **Given** una llamada de campaña (Discovery/Qualification/Activation/Conversion) completada, **When** el equipo abre el perfil del establecimiento en el CRM, **Then** aparece una nota con: nombre de campaña, etapa, resultado (contestó / no contestó / buzón / completada), duración y resumen de la conversación.
2. **Given** una llamada fallida (nadie contestó o línea ocupada), **When** el equipo revisa el perfil del establecimiento, **Then** aparece un registro "sin contacto" con fecha, campaña origen y motivo del fallo.
3. **Given** que la misma llamada genera múltiples notificaciones del sistema (reintentos o doble disparo), **When** se consulta el historial, **Then** aparece exactamente UNA nota por llamada, sin duplicados.
4. **Given** el envío de un cupón por WhatsApp al establecimiento, **When** el equipo revisa el perfil, **Then** aparece una nota "Cupón enviado" con código, oferta y fecha; al canjearse, aparece una nota adicional "Cupón redimido" con fecha de redención.
5. **Given** un establecimiento con historial de campañas previas al despliegue del sistema nuevo, **When** se ejecuta la carga histórica, **Then** todas sus interacciones anteriores aparecen en el CRM sin duplicar las ya existentes.

---

### User Story 2 — Estado del pipeline filtrable por campaña (Priority: P1)

El equipo puede filtrar en el CRM por campaña activa, ver cuántos establecimientos fueron contactados esta semana, cuáles avanzaron de nivel y cuáles no han sido contactados en más de X días. Esto reemplaza consultar reportes externos o bases de datos para hacer seguimiento.

**Why this priority**: Permite identificar cuellos de botella y priorizar seguimientos sin salir del CRM. Cubre la parte de "pronósticos y pipeline management" del análisis comparativo.

**Independent Test**: Abrir la vista de Companies en Twenty y filtrar por `fechaUltimaLlamada` mayor a 30 días o por nombre de campaña específica, y obtener resultados correctos sin exportar datos.

**Acceptance Scenarios**:

1. **Given** un Company en Twenty, **When** se completa una llamada de campaña, **Then** se actualiza automáticamente: nombre de la campaña más reciente, fecha de última llamada y contador total de llamadas de campaña.
2. **Given** múltiples Companies en Twenty, **When** el equipo aplica un filtro por nombre de campaña o por rango de fechas de última llamada, **Then** obtiene la lista correcta de establecimientos.
3. **Given** que un establecimiento avanza de nivel (Prospecto → Lead → Cliente), **When** el equipo revisa su historial, **Then** todas las interacciones previas siguen visibles (el historial nunca se borra al cambiar de nivel).

---

### User Story 3 — Automatización de seguimientos basada en datos de campaña (Priority: P2)

Marketing puede configurar reglas del tipo "si un establecimiento lleva más de 30 días sin contacto y su nivel es Prospecto, crear automáticamente una tarea de seguimiento para ventas". Estas reglas corren sin intervención manual y pueden disparar acciones tanto dentro del CRM como hacia el sistema de campañas externo.

**Why this priority**: Cubre "Automatización de flujos" del análisis. Depende completamente de P1 — sin datos de campaña en el CRM las condiciones no tienen datos que evaluar.

**Independent Test**: Configurar una regla que evalúe `fechaUltimaLlamada` mayor a 30 días en un Company con nivel Prospecto y verificar que se crea la tarea automática cuando se cumple la condición.

**Acceptance Scenarios**:

1. **Given** una regla de automatización configurada con condición sobre campos de campaña, **When** se cumple la condición, **Then** el sistema ejecuta la acción definida (crear tarea, actualizar campo, notificación interna) sin intervención manual.
2. **Given** que se requiere reencolar una campaña de llamadas como acción de automatización, **When** la regla se dispara, **Then** el CRM invoca el sistema de campañas externo vía un endpoint dedicado con autenticación, dejando trazabilidad del origen.
3. **Given** que el equipo de marketing quiere configurar las reglas de automatización, **When** se realiza la sesión de definición con el equipo técnico, **Then** las reglas quedan configuradas y validadas funcionalmente antes del lanzamiento.

---

### User Story 4 — Colaboración del equipo sobre el pipeline (Priority: P2)

Miembros de ventas, marketing y éxito del cliente operan sobre el mismo pipeline en Twenty con visibilidad compartida: mismas vistas filtradas, comentarios sobre establecimientos y permisos diferenciados por rol (ventas edita, marketing visualiza y analiza).

**Why this priority**: Cubre "Colaboración en tiempo real" del análisis. Depende de P1 para que las vistas sean útiles.

**Independent Test**: Crear un usuario de rol "Marketing" en Twenty, compartir una vista filtrada por campaña y verificar que puede ver pero no modificar registros de otros usuarios.

**Acceptance Scenarios**:

1. **Given** múltiples usuarios con diferentes roles, **When** acceden al pipeline, **Then** cada usuario opera según sus permisos sin poder acceder a datos fuera de su alcance.
2. **Given** una vista filtrada creada por ventas, **When** se comparte con marketing, **Then** marketing puede acceder a la misma vista sin reconfigurarla.
3. **Given** que el equipo necesita capacitación, **When** se realiza la sesión de onboarding, **Then** el equipo puede operar el pipeline, vistas y automatizaciones de forma autónoma (verificado con ejercicio práctico).

---

### User Story 5 — Ingesta de leads desde Meta Lead Ads y Manychat (Priority: P3)

Un lead capturado en Meta o via Manychat aparece automáticamente en el CRM como nuevo registro, sin copia manual de datos. Completa el ciclo: captura digital → CRM → campaña de llamadas.

**Why this priority**: Cubre "Integraciones" del análisis. Es P3 porque requiere validación técnica con plataformas externas y acuerdos que están fuera del control directo del equipo de desarrollo.

**Independent Test**: Crear un lead de prueba en Meta Lead Ads y verificar que aparece como Company en Twenty en menos de 5 minutos.

**Acceptance Scenarios**:

1. **Given** un formulario de Meta Lead Ads activo, **When** un usuario completa el formulario, **Then** el lead aparece como registro nuevo en el CRM con nombre, teléfono y negocio en un tiempo razonable.
2. **Given** un lead cualificado capturado via Manychat, **When** el flujo de conversación lo identifica como prospecto de EasyOrder, **Then** el registro aparece en el CRM para seguimiento por parte del equipo de campañas.
3. **Given** que el mismo lead llega por múltiples canales (Meta + Manychat), **When** el sistema lo ingesta, **Then** se consolida como un solo registro sin duplicados.

---

### Edge Cases

- ¿Qué ocurre si el Company en el CRM fue eliminado manualmente cuando llega una nueva interacción de campaña? El sistema debe registrar el error con trazabilidad suficiente para diagnóstico (T016: skip de la Note con log estructurado; re-creación del Company no es automática — requiere intervención manual).
- ¿Cómo se maneja una llamada que duró 0 segundos (error de conexión inmediato)? Debe generar nota de "sin contacto" igualmente.
- ¿Qué pasa si el webhook de ElevenLabs llega antes de que el agente guarde el resultado en la base de datos interna? El sistema debe manejar el orden de llegada sin perder datos.
- ¿Qué ocurre si una automatización intenta actuar sobre un establecimiento ya dado de baja? La acción debe fallar de forma controlada y registrar el motivo.
- ¿Cómo se manejan los duplicados si el mismo establecimiento tiene múltiples registros históricos en el CRM por errores anteriores? El backfill debe incluir lógica de detección de duplicados.
- ¿Qué pasa si los campos custom de campaña en Twenty no existen al momento de desplegarse el código que los escribe? El sistema debe fallar de forma controlada y alertar, no silenciosamente ignorar la escritura.

---

## Requirements *(mandatory)*

### Functional Requirements

**Historial de interacciones (P1)**

- **FR-001**: El sistema DEBE registrar automáticamente cada llamada de campaña completada (exitosa o fallida) como una nota en el perfil del establecimiento en el CRM, sin intervención manual.
- **FR-002**: El sistema DEBE garantizar que una misma llamada genera exactamente una nota en el CRM, incluso ante reintentos del sistema, retries del webhook o doble disparo de notificaciones.
- **FR-002b**: Las notas de llamadas completadas con conversación real DEBEN sincronizarse con reintentos sin límite de intentos hasta garantizar su llegada al CRM. Las notas de llamadas no conversacionales (FAILED, NO_ANSWER, VOICEMAIL) usan best effort con máximo 5 reintentos y backoff exponencial — su pérdida eventual es aceptable.
- **FR-003**: Las notas de interacción de llamada DEBEN incluir: nombre de campaña, etapa (Discovery/Qualification/Activation/Conversion), resultado (contestó/no contestó/buzón/completada), duración y resumen de la conversación cuando esté disponible.
- **FR-004**: Las notas DEBEN permanecer visibles en el historial del establecimiento independientemente de los cambios de nivel del mismo.
- **FR-005**: El envío de un cupón por WhatsApp y su redención posterior DEBEN generar notas separadas en el perfil del establecimiento.
- **FR-006**: El sistema DEBE cargar retroactivamente TODAS las interacciones históricas desde el inicio de las campañas (sin corte de fecha), de forma re-ejecutable y sin generar duplicados. La idempotencia está garantizada por el dedupeKey de cada interacción.

**Pipeline management (P1)**

- **FR-007**: El perfil de cada establecimiento en el CRM DEBE mostrar: nombre de la última campaña que lo contactó, fecha de la última llamada de campaña y número total de llamadas de campaña recibidas.
- **FR-008**: Los campos de campaña DEBEN ser consultables y filtrables desde las vistas del CRM para segmentación y análisis.
- **FR-009**: El nivel de avance del establecimiento en el funnel DEBE reflejarse en el CRM de forma sincronizada con el sistema de campañas.
- **FR-009b**: El sistema DEBE manejar de forma controlada el caso en que el registro del establecimiento en el CRM no exista al momento de procesar una interacción — creándolo o registrando el error con trazabilidad.

**Automatización (P2)**

- **FR-010**: El sistema DEBE soportar reglas de automatización que evalúen condiciones sobre campos de campaña (última llamada, nivel, resultado) y ejecuten acciones configuradas sin intervención manual.
- **FR-011**: Las automatizaciones DEBEN poder invocar el sistema de campañas externo (reencolar llamadas, asignar tareas manuales) mediante un endpoint dedicado con autenticación explícita.
- **FR-012**: Los campos custom de campaña en el CRM DEBEN existir en el entorno de producción ANTES de desplegarse el código que los escribe (orden de despliegue documentado).

**Colaboración (P2)**

- **FR-013**: El CRM DEBE soportar múltiples roles con permisos diferenciados para acceso y edición del pipeline. El rol Marketing lee todos los campos del Company y puede editar solo campos propios de su área (comentarios, etiquetas de segmentación); no puede modificar campos operativos de ventas (nivel, etapa de campaña, datos de contacto).
- **FR-014**: El equipo DEBE poder crear y compartir vistas filtradas del pipeline entre miembros.

**Integraciones externas (P3 — Discovery)**

- **FR-015**: El sistema DEBE integrarse con Meta Lead Ads para la ingesta automática de leads hacia el CRM (sujeto a validación técnica previa).
- **FR-016**: El sistema DEBE integrarse con Manychat para la ingesta de prospectos cualificados hacia el CRM (sujeto a validación técnica previa).
- **FR-017**: El sistema DEBE deduplicar registros cuando el mismo lead llegue desde múltiples fuentes externas.

### Key Entities

- **Establecimiento (Company en Twenty)**: Restaurante u negocio prospecto. Objeto estable en todo el ciclo de vida. Tiene campos de campaña: última campaña, fecha última llamada, total llamadas.
- **Interacción (Note en Twenty)**: Registro individual de una llamada de campaña, cupón u otra actividad. Siempre anclada al Company. Incluye etapa, resultado, resumen y campaña origen.
- **Nivel (Level)**: Estado de avance del establecimiento: Establecimiento → Contacto → Prospecto → Lead → Cliente. Controla qué agente de voz actúa sobre él.
- **Campaña**: Conjunto de llamadas de un tipo específico con un agente de voz asignado y alcance geográfico.
- **Cupón**: Beneficio comercial generado para un establecimiento, rastreable desde envío hasta redención.
- **Regla de automatización**: Condición + acción configurada en el CRM que se evalúa cuando cambian datos del pipeline.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las llamadas de campaña completadas (exitosas y fallidas) generan un registro visible en el CRM en menos de 5 minutos desde que finaliza la llamada.
- **SC-002**: Cero notas duplicadas generadas por reintentos del sistema en 30 días de operación en producción (verificable via query de dedupeKey).
- **SC-003**: El equipo puede identificar en menos de 30 segundos cuántas llamadas recibió un establecimiento y cuál fue el resultado de la más reciente, sin salir del CRM.
- **SC-004**: El proceso de backfill histórico carga el 95%+ de las interacciones previas sin duplicados, verificado con dry-run antes de ejecutar en producción.
- **SC-005**: Al menos 2 reglas de automatización configuradas y validadas funcionalmente con el equipo de marketing antes del lanzamiento.
- **SC-006**: El equipo de ventas y marketing puede operar el pipeline de forma autónoma tras una sesión de capacitación (tasa de adopción medida a los 15 días del lanzamiento).
- **SC-007**: Cero llamadas completadas con conversación real perdidas permanentemente por fallo del CRM — el sistema reintenta hasta garantizar la entrega (verificable en logs de jobs INTERACTION con status final diferente a PENDING/RETRYING).

---

## Gaps identificados vs issues existentes en Huly

Los siguientes requerimientos de este spec **no tienen issue correspondiente** en el backlog actual y deben crearse:

### GAP-1: Manejo de Company inexistente en Twenty al procesar interacción
**Relacionado con**: FR-009b, Edge Case #1
**Descripción**: CRM-849 asume que `TwentySyncState` existe o lo crea, pero no documenta qué ocurre si el Company fue eliminado manualmente en Twenty. El criterio de aceptación de CRM-853 no incluye este escenario.
**Acción recomendada**: Agregar escenario explícito en CRM-853 y documentar el comportamiento esperado en CRM-849 (re-crear Company o fallar con log específico).

### GAP-2: Smoke test de campos custom antes de deploy en producción
**Relacionado con**: FR-012, CRM-855
**Descripción**: No existe un criterio que garantice que los campos `ultimaCampana`, `fechaUltimaLlamada` y `totalLlamadasCampana` existen en producción ANTES de desplegar el código que los escribe. Una escritura silenciosa fallida no sería evidente hasta revisar logs.
**Acción recomendada**: Agregar a CRM-855 un criterio de aceptación: "El deploy del código de CRM-856 incluye una verificación de existencia de campos al arrancar; si los campos no existen, el proceso falla de forma visible con mensaje claro".

### GAP-3: Deduplicación de leads multi-canal (Meta + Manychat)
**Relacionado con**: FR-017, CRM-870
**Descripción**: CRM-870 es solo Discovery. No existe issue que cubra la lógica de deduplicación cuando el mismo lead llega desde Meta y Manychat simultáneamente.
**Acción recomendada**: Agregar como sub-tarea de CRM-870 o nueva issue cuando se active la implementación de integraciones.

### GAP-4: Endpoint /crm-hooks sin autenticación explícita documentada
**Relacionado con**: FR-011, CRM-863/864
**Descripción**: CRM-864 describe la implementación del endpoint pero no menciona explícitamente el mecanismo de autenticación. Al ser invocado desde Workflows de Twenty (externos), debe tener autenticación robusta.
**Acción recomendada**: Agregar criterio de aceptación en CRM-864: "El endpoint /crm-hooks requiere autenticación via API Key en header `x-api-key`; solicitudes sin key válida devuelven 401".

---

## Assumptions

- El CRM desplegado (Twenty) soporta notas nativas, campos custom en Company y la API REST necesaria. La validación técnica está en progreso (CRM-861/862) y es prerequisito de todo lo demás.
- Los Workflows nativos de Twenty soportan condiciones sobre campos custom y acciones de tipo HTTP hacia sistemas externos. Debe verificarse antes de comprometerse con FR-010 y FR-011.
- Las integraciones con Meta Lead Ads y Manychat (FR-015, FR-016) requieren acceso a APIs de plataformas externas fuera del control directo del equipo de desarrollo; se mantienen como Discovery hasta confirmación formal.
- Los datos históricos de campañas están disponibles en `CampaignContact` y tablas de enrichment del sistema existente y son suficientes para el backfill (FR-006).
- Los campos custom de campaña en Twenty se crean manualmente por el equipo ANTES del deploy del código (FR-012). Este riesgo de orden de despliegue está identificado y debe gestionarse explícitamente.
- La capacitación del equipo de marketing requiere al menos una sesión presencial o remota con los usuarios finales antes del lanzamiento de P2.
