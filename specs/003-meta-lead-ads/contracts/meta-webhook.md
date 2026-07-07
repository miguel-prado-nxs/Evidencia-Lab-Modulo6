# Contract: Webhook de Meta Lead Ads

**Endpoint**: `/api/v1/webhooks/meta-leads`

Sigue el patrón de `src/routes/webhooks.js` (webhooks públicos con verificación propia en vez de `authenticateApiKey`, ya que el emisor externo no puede enviar ese header).

---

## `GET /api/v1/webhooks/meta-leads`

Verificación de suscripción del webhook — Meta llama este endpoint una vez al configurar la suscripción en el App Dashboard.

**Query params** (enviados por Meta):

| Param | Tipo | Descripción |
|---|---|---|
| `hub.mode` | string | Siempre `"subscribe"` |
| `hub.verify_token` | string | Debe coincidir con `config.meta.webhookVerifyToken` |
| `hub.challenge` | string | Debe devolverse tal cual en el body de la respuesta |

**Respuesta**:
- `200` con body = valor exacto de `hub.challenge` (texto plano, no JSON) — si `hub.verify_token` coincide.
- `403` sin body — si no coincide.

---

## `POST /api/v1/webhooks/meta-leads`

Notificación de un nuevo lead (`leadgen`).

**Headers requeridos**:

| Header | Descripción |
|---|---|
| `X-Hub-Signature-256` | Firma HMAC-SHA256 del body crudo, con `meta_app_secret` como clave (formato `sha256=<hex>`) |

**Body** (formato de Meta, resumido a los campos que se usan):

```json
{
  "object": "page",
  "entry": [
    {
      "id": "<page_id>",
      "time": 1234567890,
      "changes": [
        {
          "field": "leadgen",
          "value": {
            "leadgen_id": "...",
            "page_id": "...",
            "form_id": "...",
            "adgroup_id": "...",
            "ad_id": "...",
            "created_time": 1234567890
          }
        }
      ]
    }
  ]
}
```

**Validación** (Zod, en el controller):
- `object` debe ser `"page"`.
- `entry` debe ser un array no vacío.
- Cada `changes[].value` debe tener `leadgen_id`, `page_id`, `form_id` como strings no vacíos.

**Comportamiento**:

1. Verificar `X-Hub-Signature-256` contra el body crudo. Si no coincide → `403`, no procesar, no responder al webhook (evita darle información a un atacante).
2. Si la firma es válida:
   - Responder `200` inmediatamente (antes de terminar el procesamiento — mismo patrón que `crmHooksController.js`).
   - Por cada `changes[]` con `field === "leadgen"`: insertar `MetaLeadWebhookEvent` con upsert no-op en conflicto de `leadgenId` (deduplicación), y si es una inserción nueva, encolar `MetaLeadJob`.
3. Si `META_LEAD_ADS_ENABLED` es `false` (permiso de Meta aún no aprobado): igual se responde `200` y se guarda el `MetaLeadWebhookEvent` (para no perder el dato), pero el job de procesamiento no se encola — queda documentado como pendiente para cuando se active el flag.

**Respuesta esperada por Meta**: `200` en menos de unos segundos, o Meta reintenta la notificación (de ahí la importancia de la deduplicación por `leadgenId`, no solo de responder rápido).

---

## Contrato interno: `GET /{leadgen_id}` (Graph API de Meta, consumido por el worker)

No es un endpoint propio — se documenta aquí porque es la llamada que el `MetaLeadJob` hace para obtener los datos completos del lead.

**Request**: `GET https://graph.facebook.com/v21.0/{leadgen_id}?access_token={page_access_token}`

**Response relevante**:

```json
{
  "id": "...",
  "created_time": "...",
  "field_data": [
    { "name": "full_name", "values": ["Juan Pérez"] },
    { "name": "phone_number", "values": ["+521234567890"] },
    { "name": "email", "values": ["juan@example.com"] }
  ]
}
```

**Manejo de error** (edge case del spec): si esta llamada falla (timeout, 4xx, 5xx), el `MetaLeadJob` se marca `FAILED` con `lastError` y reintenta con backoff — mismo patrón que `processPendingJobs` de `twentySyncService.js`. No se pierde la notificación original porque ya está persistida en `MetaLeadWebhookEvent`.
