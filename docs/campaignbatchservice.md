# Campaign Batch Service

### ¿Qué hace el servicio?
1. Valida parámetros de entrada (`campaignId`, `agentId`, `recipients`, API key).
2. Normaliza y valida recipients (teléfono + `campaignContactId`).
3. Construye payload con `dynamic_variables` por contacto.
4. Divide recipients en chunks (límite configurable por request).
5. Envía cada chunk a ElevenLabs (`/v1/convai/batch-calling/submit`).
6. Persiste `providerBatchId` y respuesta raw por contacto.
7. Expone estadísticas agregadas de envío por campaña.

---
### Reglas de negocio aplicadas
- `campaignId`, `agentId`, `ELEVENLABS_API_KEY` y `recipients` son obligatorios.
- Si un recipient no tiene teléfono válido o `campaignContactId`, se marca como inválido y se omite.
- Siempre se agrega `campaignId` en `dynamic_variables`.
- `couponCode` **no** se envía en el payload inicial.
- Se permite `scheduled_time_unix` y `agent_phone_number_id` como opcionales.
- Configuración robusta: concurrencia y tamaño de chunk se fuerzan a enteros positivos.

---
### Reglas de teléfono (normalización)
- Si el número ya viene con `+` (ej. `+1`, `+52`), se respeta la lada.
- Si viene con 10 dígitos, se asume MX y se transforma a `+52XXXXXXXXXX`.
- Si viene como `52XXXXXXXXXX`, se transforma a `+52XXXXXXXXXX`.
- Si no cumple formato válido E.164 esperado, se rechaza como inválido.

---
### Manejo de errores
- `422`: payload rechazado por proveedor.
- `429`: rate limit del proveedor.
- `timeout`: request excede tiempo configurado.
- Todos se registran con logs estructurados y se relanza error normalizado (`statusCode`, `details`).

---
### Persistencia y trazabilidad
- Se guarda `providerBatchId` en `CampaignContact`.
- Se guarda metadata del envío en `establishmentData.batchDispatch`:
  - `provider`
  - `providerBatchId`
  - `submittedAt`
  - `rawProviderResponse`

---
### Reconciliación e idempotencia

El worker `campaignBatchReconciliationWorker.js` actúa como un supervisor en segundo plano para asegurar que los estados de los contactos sean consistentes, incluso si fallan las notificaciones externas.

#### 1. Idempotencia por `conversationId`
- **Lógica**: Si el worker encuentra un contacto en `CALLING` pero ya existe otro registro con el mismo `conversationId` que tiene `webhookReceivedAt != null`, el contacto actual se ignora (`idempotency_skip`).
- **Propósito**: Evita sobreescribir estados finales exitosos si un webhook llega justo en el umbral de revisión del worker.

#### 2. Detección de Llamadas Huérfanas (Timeout)
- **Umbral**: 4 Horas (configurable vía `CAMPAIGN_CALLING_TIMEOUT_HOURS`).
- **Acción**: Si un contacto lleva más de 4 horas en estado `CALLING` sin haber recibido un webhook, se marca automáticamente como `FAILED`.
- **Registro de Error**: El motivo se guarda tanto en `errorReason` como en el JSON `establishmentData.reconciliation.errorMessage`, permitiendo trazabilidad detallada en la UI.

#### 3. Recálculo Automático de Métricas
- Tras cada ciclo de reconciliación, el worker suma los estados de todos los contactos de la campaña y actualiza la tabla `Campaign` (`totalCalled`, `totalFailed`, `couponsSent`, etc.).
- Esto asegura que los paneles de control del CRM reflejen siempre la realidad operativa sin intervención manual.

---
### Métricas disponibles (`getCampaignBatchDispatchStats`)
- `totalContacts`
- `dispatchedContacts`
- `pendingContacts`
- `dispatchRate`
- `totalBatches`
- distribución por `providerBatchId`
- breakdown por `status` de contacto

---

### Límites y Configuración Recomendada (Batch Calling)

Aunque el endpoint sea oficial, los límites efectivos pueden variar por cuenta/plan y por condiciones de tráfico.  
Para evitar errores operativos (`429`, timeouts), se recomienda una estrategia progresiva.

#### Límites prácticos a considerar
1. **Recipients por request** (tamaño de lote por envío)
2. **Concurrencia objetivo** (`target_concurrency_limit`)
3. **Rate limit global del proveedor** (respuestas `429`)

#### Configuración inicial sugerida
- `ELEVENLABS_BATCH_MAX_RECIPIENTS_PER_REQUEST=100`
- `ELEVENLABS_BATCH_TARGET_CONCURRENCY=10`
- `ELEVENLABS_BATCH_TIMEOUT_MS=15000`

#### Estrategia de rollout
- **Staging / pruebas iniciales:** 50 recipients por request
- **Canary en producción:** 100 recipients por request
- **Escalado gradual:** subir a 150–200 solo si no hay `429` ni timeouts

#### Regla operativa de ajuste
- Si aparecen `429` o timeouts:
  - bajar `MAX_RECIPIENTS_PER_REQUEST` a `50-80`
  - bajar `TARGET_CONCURRENCY` a `5-8`
- Si hay estabilidad por varios ciclos:
  - subir en pasos de `25-50` recipients
  - mantener monitoreo de latencia y tasa de error

#### Señales de estabilidad para escalar
- Error rate < 1%
- Sin `429` sostenidos
- Sin timeouts recurrentes
- Dispatch completado consistentemente en ventanas esperadas

---

### Endpoint para iniciar campaña (`TASK-007`)

Se agregó el endpoint:

- `POST /api/v1/campaigns/:id/start`

#### Body opcional

```json
{
  "agentId": "agent_123",
  "targetConcurrencyLimit": 10,
  "maxRecipientsPerRequest": 100,
  "scheduledTimeUnix": 1763330400,
  "agentPhoneNumberId": "phone_abc"
}
```

#### Flujo al iniciar

1. Valida estado de campaña (`DRAFT`/`PAUSED` permitido, `ACTIVE`/`COMPLETED`/`CANCELLED` bloqueado).
2. Obtiene contactos `PENDING` de la campaña.
3. Hidrata teléfono/nombre con snapshot del contacto y fallback a Geo DB (`Establishment`).
4. Construye `dynamic_variables` por contacto: `campaignId`, `campaignContactId`, `prospectName`, `businessName`, `couponType`, `agentConfigId`, `campaignContext`.
5. Envía lotes vía `campaignBatchDispatcherService.submitCampaignBatch`.
6. Si el dispatch termina bien:
   - actualiza campaña a `ACTIVE` y `startedAt`
   - cambia contactos despachados a `CALLING`
7. Si hay recipients inválidos (ej. teléfono inválido), esos contactos se marcan como `FAILED` con `errorReason` para no dejarlos en `PENDING`.

#### Notas

- Si no hay `agentId` en request, usa `campaign.agentConfigId`.
- Si no hay contactos `PENDING`, responde error de validación.
- Si falla la lectura de Geo DB, el endpoint continúa usando snapshot de `CampaignContact` (no bloquea el inicio de campaña).
- El endpoint no ejecuta llamadas directas; solo dispara batch calling y sincroniza estados iniciales.

---

### Guía rápida para conectar el botón "Iniciar" (Frontend)

Esta sección es para la persona que conectará el botón de UI con el backend.

#### 1) Disparar request al endpoint

- Endpoint: `POST /api/v1/campaigns/:id/start`
- Header: `Authorization: Bearer <token>`
- Body recomendado (mínimo viable):

```json
{
  "targetConcurrencyLimit": 10,
  "maxRecipientsPerRequest": 100
}
```

> `agentId` es opcional si la campaña ya tiene `agentConfigId` guardado.

#### 2) Estado del botón en UI

- Al hacer click en "Iniciar":
  - deshabilitar botón
  - mostrar loading/spinner
- Si responde `200`:
  - actualizar campaña a estado `ACTIVE` en la tabla
  - mostrar toast: "Campaña iniciada exitosamente"
  - refrescar detalle/listado para ver contactos en `CALLING`
- Si responde error:
  - re-habilitar botón
  - mostrar mensaje según `error` del backend

#### 3) Manejo de errores esperado

- `400`: no hay contactos `PENDING` o falta `agentId` resolvible
- `403`: usuario sin permisos
- `404`: campaña no encontrada
- `409`: campaña ya activa o no iniciable por estado

#### 4) Regla simple para mostrar/ocultar botón

- Mostrar botón "Iniciar" solo si estado es `DRAFT` o `PAUSED`.
- Ocultar o deshabilitar en `ACTIVE`, `COMPLETED`, `CANCELLED`.

#### 5) Checklist manual de validación

1. Crear campaña con contactos `PENDING`.
2. Click en "Iniciar".
3. Verificar response `200` y campaña en `ACTIVE`.
4. Verificar contactos cambiando a `CALLING`.
5. Verificar que contactos inválidos (si existen) queden en `FAILED` con `errorReason`.

---

### Endpoint webhook de cierre (`TASK-008`)

Se agregó el endpoint público:

- `POST /api/v1/campaigns/elevenlabs-webhook`

#### Seguridad y validación

- Valida firma HMAC SHA-256 usando header `elevenlabs-signature` (`t=...,v0=...`).
- Usa `ELEVENLABS_WEBHOOK_SECRET` del backend para validar la firma.
- Requiere `rawBody` para validación criptográfica (configurado en `app.js`).

#### Evento procesado

- Solo procesa `type = post_call_transcription`.
- Otros eventos se ignoran con `200` para no reintentar innecesariamente.

#### Mapeo de estados de contacto

- `analysis.call_successful = true`  → `CALLED`
- `analysis.call_successful = false` → `FAILED`

> Nota: en el modelo actual de contacto no existe `COMPLETED`; el estado correcto de éxito es `CALLED`.

#### Datos que persiste en `CampaignContact`

- `status`
- `conversationId`
- `callDuration`
- `callTranscript`
- `webhookReceivedAt`
- `errorReason` (cuando la llamada falla)

#### Idempotencia

- Si el contacto ya tiene `webhookReceivedAt` con el mismo `conversationId`, el webhook se considera ya procesado.
- Si el `conversationId` ya fue procesado por otro contacto, se ignora para evitar doble actualización.

#### Cupón generado durante llamada

- Si llega `couponGenerated` en payload, busca `CampaignCoupon.code` dentro de la misma campaña.
- Si existe, vincula `couponId` al contacto.

#### Rendimiento y respuesta

- Responde `200` de forma inmediata tras el update principal.
- Recalcula métricas de campaña en segundo plano (`setImmediate`) para no bloquear el webhook.

#### Configuración requerida

- `ELEVENLABS_WEBHOOK_SECRET=<secret_firmado_por_elevenlabs>`
- URL de configuración en ElevenLabs (Event Webhooks):
  - `https://<tu-dominio>/api/v1/campaigns/elevenlabs-webhook`
