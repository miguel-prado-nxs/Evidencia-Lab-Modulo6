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

## Decisión 4: Note body en formato markdown vs blocknote

**Decision**: Usar markdown plain en el body de la Note. Verificar en CRM-848 qué acepta la API REST de Twenty de la instancia desplegada.

**Rationale**: Twenty internamente usa blocknote, pero la API REST de Twenty expone el campo `body` como string. La documentación y los tests de CRM-848 deben confirmar si el campo espera JSON blocknote o markdown. Por seguridad, el criterio de aceptación de CRM-848 incluye verificación visual en la UI de Twenty.

**Alternatives considered**: JSON blocknote — posible alternativa si el markdown no se renderiza correctamente.

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

## Pendiente de validación (CRM-862 — Spike)

Antes de comprometer implementación de automatizaciones (Fase 6):

1. ¿La instancia de Twenty desplegada tiene Workflows habilitados? ¿Versión mínima con soporte de HTTP_REQUEST action?
2. ¿La API REST de Twenty expone Notes con `POST /notes` + `POST /noteTargets` según la documentación oficial?
3. ¿El campo `body` de Note acepta markdown plain o requiere blocknote JSON?
4. ¿Existe rate limiting conocido en la API de Twenty? ¿Cuántas req/min?
5. ¿Los campos custom de Company son filtrables en vistas nativas de Twenty?
