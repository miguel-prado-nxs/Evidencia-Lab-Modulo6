# Contrato: enqueueInteractionSync (servicio interno)

**Módulo**: `src/services/twenty/twentyActivityService.js`

**Propósito**: Encola un job INTERACTION en `TwentySyncJob` para que el worker lo procese y genere una Note en el Company de Twenty CRM. Es la puerta de entrada para registrar cualquier interacción (llamada o cupón) como actividad en el CRM.

---

## Firma

```javascript
/**
 * @param {Object} params
 * @param {string} params.establishmentId   - ID del establecimiento en BD principal
 * @param {string} params.conversationId    - ID único de la conversación/evento (ElevenLabs conversationId, couponId, etc.)
 * @param {string} params.stage             - Etapa: 'discovery' | 'qualification' | 'activation' | 'conversion' | 'coupon_sent' | 'coupon_redeemed'
 * @param {string} params.outcome           - Resultado: 'COMPLETED' | 'NO_ANSWER' | 'VOICEMAIL' | 'FAILED' | 'SENT' | 'REDEEMED'
 * @param {string} [params.callSummary]     - Resumen de la conversación (opcional)
 * @param {number} [params.callDuration]    - Duración en segundos (opcional)
 * @param {string} [params.campaignId]      - ID de la campaña origen (opcional)
 * @param {string} [params.campaignName]    - Nombre legible de la campaña (opcional)
 * @returns {Promise<{ job: TwentySyncJob } | { skipped: true }>}
 */
async function enqueueInteractionSync(params) { ... }
```

---

## Comportamiento

### Caso normal (job nuevo)

1. Construye `dedupeKey`:
   - Para llamadas: `interaction:{conversationId}:{stage}`
   - Para cupones: `coupon:{conversationId}:{stage}`
2. Determina `maxAttempts` según `STAGE_CONFIG[stage].isConversational(outcome)`:
   - `true` (llamada conversacional) → `maxAttempts = null` (sin límite)
   - `false` (no conversacional / cupón) → `maxAttempts = 5`
3. Crea `TwentySyncJob` con `type = INTERACTION`, `status = PENDING`, `payload = { ...params }`, `dedupeKey`
4. Retorna `{ job }` con el job creado

### Caso duplicado (dedupeKey ya existe)

1. La inserción lanza `PrismaClientKnownRequestError` con código `P2002`
2. Captura el error, loggea `info` con `[TwentyActivityService] INTERACTION ya encolada, skip { dedupeKey }`
3. Retorna `{ skipped: true }`
4. **No lanza error** — el caller no necesita manejar este caso

### Caso error inesperado

1. Loggea `error` con contexto completo
2. Lanza el error para que el caller decida (generalmente fire-and-forget con `.catch(logger.error)`)

---

## Contrato de uso en funnelWebhookService (fire-and-forget)

```javascript
// Al final de endDiscoveryCall, endQualificationCall, endActivationCall, endConversionCall
// NON-BLOCKING: no await, errores solo se loggean
enqueueInteractionSync({
  establishmentId,
  conversationId,
  stage:        'discovery',  // o la etapa correspondiente
  outcome,
  callSummary,
  callDuration,
  campaignId,
  campaignName,
}).catch(err =>
  logger.error('[FunnelWebhook:endDiscoveryCall] Error encolando interaction sync', { err, establishmentId })
);
```

---

## Contrato de uso en campaignWebhookController (fallback para no conversacionales)

```javascript
// Solo para outcomes FAILED, NO_ANSWER, VOICEMAIL
// cuando el camino MCP (end*Call) no fue invocado por el agente
if (['FAILED', 'NO_ANSWER', 'VOICEMAIL'].includes(outcome)) {
  enqueueInteractionSync({
    establishmentId: contact.establishmentId,
    conversationId:  webhookPayload.conversation_id,
    stage:           derivedStage,  // derivado del agentId o campaignType
    outcome,
    campaignId:      contact.campaignId,
    campaignName:    campaign.name,
  }).catch(err =>
    logger.error('[CampaignWebhook] Error encolando fallback interaction sync', { err })
  );
}
```

---

## Contrato del payload almacenado en TwentySyncJob.payload (JSON)

```json
{
  "establishmentId": "string",
  "conversationId":  "string",
  "stage":           "string",
  "outcome":         "string",
  "callSummary":     "string | null",
  "callDuration":    "number | null",
  "campaignId":      "string | null",
  "campaignName":    "string | null",
  "enqueuedAt":      "ISO8601 datetime"
}
```

---

## Contrato de processInteractionJob (worker)

```javascript
/**
 * @param {TwentySyncJob} job - Job de tipo INTERACTION con payload poblado
 * @returns {Promise<void>}
 * @throws {Error} si hay fallo no recuperable (el worker lo captura y aplica backoff/FAILED)
 */
async function processInteractionJob(job) { ... }
```

Secuencia interna documentada en `data-model.md`.
