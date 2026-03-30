# Flujo Completo: Backend → ElevenLabs → Cupón → Analytics

**Fecha:** 30 de marzo de 2026  
**Versión:** 2.0 (híbrido multi-cupón)

---

## Diagrama General

```
FRONTEND / API
     │
     ▼
POST /api/v1/campaigns/:id/start
     │
     ▼
campaignsController.startCampaign()
     │
     ▼
campaignsService.startCampaign()
     │
     ├─► fetchAgentProfile()          ──── ElevenLabs API (valida agente)
     ├─► Agent Builder config         ──── demo-form-service (voz por defecto)
     ├─► Carga contactos PENDING      ──── PostgreSQL (GeoDb)
     │
     ├─► buildCampaignContext()       ──── campaignContextService
     │       ├─ campaign + couponTemplateIds
     │       ├─ CouponTemplate[] (activos)
     │       ├─ buildAgentInstructions()    → texto híbrido para el agente
     │       └─ buildCouponSendInstructions() → config del webhook
     │
     ├─► Construye recipients[]       ──── dynamic_variables por contacto
     │       ├─ prospectName, businessName, phoneNumber
     │       ├─ voiceId, agentName, personalityName
     │       ├─ campaignContext (objeto completo)
     │       ├─ agentInstructions (texto generado)
     │       ├─ couponType (principal)
     │       └─ couponTypes[], couponsAvailable
     │
     ▼
campaignBatchDispatcherService.submitCampaignBatch()
     │
     ▼
ElevenLabs Batch Calling API ◄────── recipients[] con dynamic_variables
     │
     ├─► Actualiza DB: campaign → ACTIVE
     └─► Actualiza DB: contacts → CALLING

════════════════════════ DURANTE LA LLAMADA ════════════════════════

ElevenLabs llama a cada contacto
     │
     ▼
Agente recibe dynamic_variables ── campaignContext, agentInstructions
     │
     ▼
Detecta escenario de la conversación
     │
     ├─ price_objection     → elige cupón 50OFF
     ├─ upgrade_interest    → elige cupón UPGRADEPRO
     ├─ trial_ending        → elige cupón TRIAL14
     ├─ referral            → elige cupón REFER
     ├─ cold_lead           → elige cupón COMEBACK
     └─ (default)           → usa cupón PRINCIPAL (couponType)
     │
     ▼
Prospecto acepta recibir cupón
     │
     ▼
POST /api/v1/coupons-whatsapp/generate-and-send
     │
     ├─► Genera código único
     ├─► Crea CampaignCoupon en DB (status: SENT)
     └─► Envía por WhatsApp via Baileys

════════════════════════ DESPUÉS DE LA LLAMADA ═════════════════════

ElevenLabs envía webhook de cierre
     │
     ▼
POST /api/v1/campaigns/elevenlabs-webhook
     │
     └─► Actualiza contacto: CALLING → SENT/FAILED

════════════════════════ TRACKING DEL CUPÓN ════════════════════════

Prospecto abre el link del cupón
     │
     ▼
POST /api/v1/coupons/:code/visit  → status: VISITED

Prospecto activa el cupón en Stripe
     │
     ▼
POST /api/v1/coupons/:code/convert → status: CONVERTED

════════════════════════ ANALYTICS ═════════════════════════════════

GET /api/v1/campaigns/:id/coupon-breakdown
     │
     └─► Métricas por couponType: sent, visited, converted, rates
```

---

## Paso 1 — Inicio de Campaña

**Trigger:** `POST /api/v1/campaigns/:id/start`

**Archivo:** `src/controllers/campaignsController.js` → `src/services/campaignsService.js:startCampaign()`

### Validaciones previas

```
campaign.status debe ser DRAFT o PAUSED
agentId resuelto: options.agentId || campaign.agentConfigId
agentPhoneNumberId: options.agentPhoneNumberId || process.env.ELEVENLABS_AGENT_PHONE_NUMBER_ID
```

### Resolución de voz (prioridad)

```
1. Agent Builder (demo-form-service) → GET /agent-configs/default/SDR|QUALIFICATION
2. ElevenLabs profile → fetchAgentProfile(agentId)
3. contactData.personalityName (fallback)
```

---

## Paso 2 — Carga de Contactos

**Archivo:** `src/services/campaignsService.js:startCampaign()` líneas 565-597

```
CampaignContact WHERE campaignId = :id AND status = PENDING

Si no hay contactos PENDING:
  → assignContactsWithGeoFilter(campaignId, campaign.filters)
  → vuelve a consultar

Si sigue vacío:
  → Error 400: "Campaign has no pending contacts"
```

---

## Paso 3 — Construcción del Contexto de Campaña

**Archivo:** `src/services/campaignContextService.js:buildCampaignContext()`

Este es el núcleo del sistema. Se ejecuta **una vez por campaña** y genera el contexto que recibe cada agente ElevenLabs.

### 3.1 Carga de datos

```javascript
// 1. Campaign con conteo de cupones
prisma.campaign.findUnique({ where: { id: campaignId }, include: { _count: { coupons } } })

// 2. CouponTemplates activos de la campaña
prisma.couponTemplate.findMany({
  where: { id: { in: campaign.couponTemplateIds }, active: true }
})
```

### 3.2 Estructura del contexto generado

```json
{
  "campaignId": "uuid",
  "campaignName": "Adquisición Q1 2026",
  "campaignType": "ACQUISITION",
  "campaignStatus": "ACTIVE",
  "campaignOffer": "Primer mes gratis",

  "coupons": {
    "available": true,
    "couponType": "PLUS30",
    "templates": [
      {
        "id": "template-uuid",
        "type": "PLUS30",
        "name": "1 mes gratis Plan Plus",
        "offer": "100% descuento + 1 mes(es)",
        "percentOff": 100,
        "durationMonths": 1,
        "trialDays": null,
        "expiresHours": 48,
        "applicableScenarios": ["bant_high", "first_contact", "high_intent"]
      },
      {
        "type": "50OFF",
        "name": "50% descuento primer mes",
        "offer": "50% descuento + 1 mes(es)",
        "applicableScenarios": ["price_objection", "high_intent"]
      }
    ],
    "totalGenerated": 120,
    "sendInstructions": {
      "enabled": true,
      "endpoint": "/api/v1/coupons-whatsapp/generate-and-send",
      "couponType": "PLUS30",
      "requiredParams": ["phone", "prospectName", "businessName", "scenario",
                         "agentId", "callId", "campaignId", "campaignContactId", "couponType"]
    }
  },

  "agentInstructions": "...(texto generado por buildAgentInstructions)...",

  "metadata": {
    "agentConfigId": "agent-uuid",
    "agentConfigName": "SDR Agent"
  }
}
```

### 3.3 Generación de instrucciones del agente

**Función:** `buildAgentInstructions(campaign, templates)` en `campaignContextService.js:165`

**Modo Simple** (1 template):
```
CUPÓN A ENVIAR:
  Tipo: PLUS30
  Nombre: 1 mes gratis Plan Plus
  Beneficio: 100% descuento + 1 mes(es)
AL FINAL DE LA LLAMADA: Si hay interés, envía couponType: "PLUS30"
```

**Modo Híbrido** (2+ templates):
```
SELECCIÓN DE CUPONES (MODO HÍBRIDO)
=============================================

CUPÓN PRINCIPAL (usar por defecto):
  Tipo: PLUS30 | Beneficio: 100% descuento + 1 mes(es)

CUPONES ALTERNATIVOS:
  [50OFF] 50% descuento primer mes
    Activar cuando: price_objection | high_intent

ÁRBOL DE DECISIÓN:
  price_objection → 50OFF
  upgrade_interest / multiple_branches → UPGRADEPRO
  trial_ending / active_free_user → TRIAL14
  referral → REFER
  abandoned_conversation / cold_lead → COMEBACK
  Cualquier otro caso → PLUS30 (principal)

REGLAS:
  1. Default: usar PRINCIPAL (PLUS30)
  2. Cambiar a alternativo solo si el escenario es claro
  3. NUNCA inventar couponType fuera de la lista
  4. NUNCA enviar sin confirmación verbal
  5. Solo UN cupón por llamada
```

---

## Paso 4 — Construcción de Recipients para ElevenLabs

**Archivo:** `src/services/campaignsService.js` líneas 634-734

Por cada contacto PENDING se construye un objeto `recipient`:

```javascript
{
  campaignContactId: "contact-uuid",
  phone_number: "523891087325",
  dynamic_variables: {
    // Identificación de campaña/contacto
    campaignId: "campaign-uuid",
    campaignContactId: "contact-uuid",
    campaignName: "Adquisición Q1 2026",
    campaignOffer: "Primer mes gratis",

    // Datos del prospecto
    prospectName: "Juan García",
    businessName: "Restaurante El Sabor",
    establishmentName: "Restaurante El Sabor",
    decisionMakerName: "Juan García",

    // Configuración de voz
    voiceId: "eleven_labs_voice_id",
    voice_id: "eleven_labs_voice_id",
    voiceName: "Valentina",
    personalityName: "Valentina",
    agentName: "Asesor EasyOrder",

    // Cupones
    couponType: "PLUS30",            // cupón principal
    couponTypes: ["PLUS30", "50OFF"],// todos los disponibles
    couponsAvailable: true,
    couponSendEndpoint: "/api/v1/coupons-whatsapp/generate-and-send",

    // Instrucciones del agente (texto completo)
    agentInstructions: "Campaña activa: ...",

    // Contexto completo como objeto
    campaignContext: { /* objeto completo buildCampaignContext */ }
  }
}
```

---

## Paso 5 — Dispatch a ElevenLabs Batch Calling

**Archivo:** `src/services/campaignBatchDispatcherService.js:submitCampaignBatch()`

```
POST https://api.elevenlabs.io/v1/convai/batch-calling
Headers: xi-api-key: ELEVENLABS_API_KEY

Body:
{
  "agent_id": "resolved_agent_id",
  "agent_phone_number_id": "phone_number_id",
  "recipients": [
    {
      "phone_number": "523891087325",
      "dynamic_variables": { /* todo el objeto de arriba */ }
    }
  ],
  "name": "campaign-Adquisición Q1 2026",
  "scheduled_time_unix": null
}
```

### Resultado

```
dispatchResult = {
  success: true,
  totalRecipients: 80,
  dispatchedRecipients: 78,
  skippedRecipients: 2,       // teléfonos inválidos → FAILED en DB
  providerBatchIds: ["batch_abc123"]
}
```

### Actualización en DB

```
campaign.status    → ACTIVE
campaign.startedAt → now()
campaignContact.status (dispatched) → CALLING
campaignContact.status (invalid)    → FAILED
```

---

## Paso 6 — ElevenLabs Llama al Contacto

ElevenLabs tiene acceso a todas las `dynamic_variables` durante la llamada.

### Variables clave disponibles en el agente

| Variable | Uso |
|---|---|
| `{{prospectName}}` | Personalizar saludo |
| `{{businessName}}` | Nombrar el restaurante |
| `{{campaignName}}` | Referencia de campaña |
| `{{couponType}}` | Cupón principal a usar |
| `{{campaignContext.coupons.templates}}` | Lista de todos los cupones |
| `{{agentInstructions}}` | Instrucciones completas con árbol de decisión |
| `{{campaignId}}` | Para el webhook de envío |
| `{{campaignContactId}}` | Para el webhook de envío |

---

## Paso 7 — Envío del Cupón (Webhook desde ElevenLabs)

Cuando el prospecto acepta el cupón, el agente llama:

**Endpoint:** `POST /api/v1/coupons-whatsapp/generate-and-send`

### Request del agente

```json
{
  "phone": "523891087325",
  "prospectName": "Juan García",
  "businessName": "Restaurante El Sabor",
  "scenario": "price_objection",
  "agentId": "eleven_labs_agent_id",
  "callId": "eleven_labs_call_id",
  "campaignId": "campaign-uuid",
  "campaignContactId": "contact-uuid",
  "couponType": "50OFF"
}
```

### Procesamiento en backend

```
1. Selecciona CouponTemplate WHERE couponType = "50OFF"
2. Genera código único: "EASY-50OFF-A3F2X9"
3. Crea CampaignCoupon:
   {
     code: "EASY-50OFF-A3F2X9",
     couponType: "50OFF",
     status: "SENT",
     campaignId: "campaign-uuid",
     assignedPhone: "523891087325",
     scenario: "price_objection",
     agentId: "...",
     callId: "...",
     sentAt: now(),
     expiresAt: now() + 48h
   }
4. Envía WhatsApp via Baileys:
   "Hola Juan García 👋
   ...50% de descuento en tu primer mes...
   Código: EASY-50OFF-A3F2X9
   https://easyorder.mx/activate?code=EASY-50OFF-A3F2X9
   ⏰ Válido por 48 horas"
```

---

## Paso 8 — Webhook de Cierre de Llamada

**Endpoint:** `POST /api/v1/campaigns/elevenlabs-webhook`

ElevenLabs notifica cuando termina cada llamada:

```json
{
  "event": "call.completed",
  "callId": "eleven_labs_call_id",
  "dynamic_variables": {
    "campaignContactId": "contact-uuid",
    "campaignId": "campaign-uuid"
  }
}
```

### Actualización en DB

```
campaignContact.status → SENT (si cupón fue enviado)
campaign.contactsSent  → +1
```

---

## Paso 9 — Tracking del Cupón

### Visita (prospecto abre el link)

```
POST /api/v1/coupons/EASY-50OFF-A3F2X9/visit
Headers: X-API-Key: {api_key}

→ campaignCoupon.status    = VISITED
→ campaignCoupon.visitedAt = now()
→ campaignCoupon.visitCount = visitCount + 1
→ campaign.couponsVisited  = +1
```

### Conversión (prospecto activa el cupón)

```
POST /api/v1/coupons/EASY-50OFF-A3F2X9/convert
Headers: X-API-Key: {api_key}
Body: { "conversionData": { "dealId": "...", "plan": "plus" } }

→ campaignCoupon.status      = CONVERTED
→ campaignCoupon.convertedAt = now()
→ campaign.couponsConverted  = +1
```

---

## Paso 10 — Analytics por Tipo de Cupón

**Endpoint:** `GET /api/v1/campaigns/:id/coupon-breakdown`

**Archivo:** `src/services/campaignsService.js:getCouponBreakdown()`

```json
{
  "campaignId": "campaign-uuid",
  "campaignName": "Adquisición Q1 2026",
  "breakdown": [
    {
      "couponType": "PLUS30",
      "name": "1 mes gratis Plan Plus",
      "metrics": {
        "sent": 60,
        "visited": 18,
        "converted": 7,
        "visitRate": "30.00",
        "conversionRate": "11.67"
      }
    },
    {
      "couponType": "50OFF",
      "name": "50% descuento primer mes",
      "metrics": {
        "sent": 18,
        "visited": 8,
        "converted": 4,
        "visitRate": "44.44",
        "conversionRate": "22.22"
      }
    }
  ],
  "totals": {
    "sent": 78,
    "visited": 26,
    "converted": 11,
    "visitRate": "33.33",
    "conversionRate": "14.10"
  }
}
```

---

## Mapa de Archivos

| Responsabilidad | Archivo |
|---|---|
| Ruta de inicio | `src/routes/campaigns.js` |
| Controller inicio | `src/controllers/campaignsController.js` |
| Lógica inicio + recipients | `src/services/campaignsService.js` |
| Contexto y instrucciones | `src/services/campaignContextService.js` |
| Dispatch a ElevenLabs | `src/services/campaignBatchDispatcherService.js` |
| Generación + envío cupón | `src/services/couponGeneratorService.js` + ruta coupons-whatsapp |
| Analytics por tipo | `src/services/campaignsService.js:getCouponBreakdown()` |
| Schema BD | `prisma/schema.prisma` |
| Templates de cupones | `prisma/seed-coupon-templates.js` |

---

## Variables de Entorno Requeridas

```env
# ElevenLabs
ELEVENLABS_API_KEY=
ELEVENLABS_SDR_AGENT_ID=
ELEVENLABS_QUALIFICATION_AGENT_ID=
ELEVENLABS_AGENT_PHONE_NUMBER_ID=

# Agent Builder (voz)
DEMO_FORM_SERVICE_URL=http://localhost:3001/api
AGENTS_CONFIG_KEY=

# Baileys (WhatsApp)
BAILEYS_SERVICE_URL=
BAILEYS_API_KEY=

# Base de datos
DATABASE_URL=
GEO_DATABASE_URL=
```

---

## Estados de un Contacto

```
PENDING   → contacto asignado, aún no enviado
CALLING   → dispatch enviado a ElevenLabs
SENT      → llamada completada, cupón enviado
FAILED    → teléfono inválido o error
VISITED   → prospecto abrió el link del cupón
CONVERTED → prospecto activó el cupón
```

---

## Estados de un Cupón (CampaignCoupon)

```
GENERATED → creado pero no enviado (bulk pre-generado)
SENT      → enviado al prospecto por WhatsApp
VISITED   → prospecto abrió el link
CONVERTED → prospecto activó el código
EXPIRED   → venció sin ser usado (48h)
```

---

## Documentación Relacionada

- `docs/ELEVENLABS_PROMPT_CAMPANAS.md` — Prompt completo del agente con árbol de decisión
- `docs/COUPON_BREAKDOWN_ANALYTICS.md` — Endpoint de analytics detallado
- `docs/COUPONS_SYSTEM.md` — Sistema completo de cupones
- `docs/ELEVENLABS_CAMPAIGN_CONTEXT.md` — Estructura de dynamic_variables
- `COUPON_WHATSAPP_INTEGRATION.md` — Integración con Baileys
