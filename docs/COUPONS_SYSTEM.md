# Sistema de Cupones - Documentación Técnica

## 📋 Índice

1. [Descripción General](#descripción-general)
2. [Arquitectura](#arquitectura)
3. [Modelos de Datos](#modelos-de-datos)
4. [API Endpoints](#api-endpoints)
5. [Flujos de Uso](#flujos-de-uso)
6. [Integración con Agentes](#integración-con-agentes)
7. [Integración con Stripe](#integración-con-stripe)

---

## Descripción General

El sistema de cupones permite generar, distribuir y trackear cupones promocionales para EasyOrder. Los cupones pueden ser:

- **Generados en bulk** para campañas masivas
- **Generados on-demand** durante llamadas de agentes de voz
- **Personalizados** con mensajes específicos según el escenario
- **Rastreables** desde generación hasta conversión

### Tipos de Cupones Base

| Tipo | Código | Beneficio | Uso |
|------|--------|-----------|-----|
| **PLUS30** | `EASY-PLUS30-XXXXXX` | 1 mes gratis Plan Plus | Lead con alta intención |
| **50OFF** | `EASY-50OFF-XXXXXX` | 50% descuento 1er mes | Objeción de precio |
| **TRIAL14** | `EASY-TRIAL14-XXXXXX` | +14 días de prueba | Trial terminando |
| **UPGRADEPRO** | `EASY-UPGRADEPRO-XXXXXX` | Pro al precio de Plus | Cliente Plus creciendo |
| **REFER** | `EASY-REFER-XXXXXX` | 1 mes gratis ambos | Programa de referidos |
| **COMEBACK** | `EASY-COMEBACK-XXXXXX` | 30% descuento | Lead que abandonó |

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                    FLUJO DE CUPONES                             │
└─────────────────────────────────────────────────────────────────┘

1. GENERACIÓN
   ├─ Bulk (Campañas)
   │  └─ POST /coupons/bulk → Genera N cupones
   │
   └─ On-demand (Agentes)
      └─ POST /coupons/generate-for-call → Genera 1 cupón personalizado

2. DISTRIBUCIÓN
   └─ Agente ElevenLabs → Baileys Service → WhatsApp

3. TRACKING
   ├─ POST /coupons/:code/visit → Marca como visitado
   ├─ POST /coupons/:code/redeem → Redime y crea promo Stripe
   └─ POST /coupons/:code/convert → Marca como convertido

4. ATRIBUCIÓN
   └─ Datos guardados: agentId, callId, scenario, phone
```

---

## Modelos de Datos

### CampaignCoupon

```prisma
model CampaignCoupon {
  id         String   @id @default(uuid())
  campaignId String?  // Nullable para cupones ad-hoc
  
  // Código único
  code       String   @unique  // EASY-PLUS30-A3F2X9
  offer      String              // Texto descriptivo
  
  // Configuración Stripe
  couponType     String?  // PLUS30, 50OFF, etc.
  percentOff     Int?     // 0-100
  durationMonths Int?     // 1, 2, 3...
  trialDays      Int?     // Para extensión de trial
  stripePromoId  String?  // ID del Promotion Code en Stripe
  
  // Tracking
  status        CouponStatus  // GENERATED, SENT, VISITED, CONVERTED, EXPIRED
  generatedAt   DateTime
  sentAt        DateTime?
  visitedAt     DateTime?
  convertedAt   DateTime?
  
  // Tracking avanzado
  scenario      String?   // "bant_high", "price_objection"
  assignedPhone String?   // Teléfono del prospecto
  assignedAt    DateTime?
  expiresAt     DateTime? // 48h desde asignación
  
  // Atribución
  source        String?   // "agent_call", "campaign"
  agentId       String?   // ID del agente
  callId        String?   // ID de llamada ElevenLabs
  
  // Metadata
  visitCount    Int
  conversionData Json?
}
```

### CouponTemplate

```prisma
model CouponTemplate {
  id          String   @id @default(uuid())
  couponType  String   @unique  // PLUS30, 50OFF, etc.
  name        String
  description String?
  
  // Escenarios donde aplica
  scenarios   String[]  // ["bant_high", "price_objection"]
  
  // Configuración Stripe
  percentOff     Int?
  durationMonths Int?
  trialDays      Int?
  
  // Plantilla de mensaje WhatsApp
  messageTemplate String  // Con variables {{nombre}}, {{negocio}}, {{codigo}}
  mediaUrl        String?
  
  // Reglas
  maxPerUser   Int      // Máximo de cupones por usuario
  expiresHours Int      // Horas hasta expiración
  validFor     String[] // ["new_users", "upgrade"]
  
  active      Boolean
  priority    Int
}
```

---

## API Endpoints

### Cupones

#### POST /api/v1/coupons/generate-for-call
**Genera cupón durante llamada de agente**

**Auth:** API Key

**Body:**
```json
{
  "phone": "5215512345678",
  "prospectName": "Carlos",
  "businessName": "La Taquería del Centro",
  "scenario": "bant_high",
  "bantScores": {
    "budget": 8,
    "authority": 9,
    "need": 10,
    "timing": 7
  },
  "agentId": "agent-123",
  "callId": "call-456",
  "campaignId": "campaign-789" // Opcional
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "coupon": {
      "id": "uuid",
      "code": "EASY-PLUS30-A3F2X9",
      "offer": "1 mes gratis de EasyOrder Plus",
      "expiresAt": "2026-03-19T14:00:00Z"
    },
    "message": "¡Hola Carlos! 👋\n\nFue un gusto platicar sobre La Taquería del Centro...",
    "mediaUrl": null
  }
}
```

#### POST /api/v1/coupons/:code/redeem
**Redime cupón y crea promoción en Stripe**

**Auth:** API Key

**Body:**
```json
{
  "userData": {
    "userId": "user-123",
    "email": "carlos@taqueria.com"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "coupon": {
      "id": "uuid",
      "code": "EASY-PLUS30-A3F2X9",
      "status": "CONVERTED"
    },
    "stripeConfig": {
      "percentOff": 100,
      "durationMonths": 1,
      "trialDays": null
    }
  }
}
```

#### POST /api/v1/coupons/check-eligibility
**Verifica si un usuario puede recibir cupón**

**Auth:** API Key

**Body:**
```json
{
  "phone": "5215512345678",
  "couponType": "PLUS30"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "eligible": true
  }
}
```

#### POST /api/v1/coupons/bulk
**Genera cupones en bulk para campaña**

**Auth:** JWT

**Body:**
```json
{
  "campaignId": "campaign-123",
  "count": 100,
  "offerTemplate": "1 mes gratis Plan Plus"
}
```

#### GET /api/v1/coupons?campaignId=xxx
**Lista cupones de una campaña**

**Auth:** JWT

#### POST /api/v1/coupons/:code/visit
**Marca cupón como visitado**

**Auth:** API Key

#### POST /api/v1/coupons/:code/convert
**Marca cupón como convertido**

**Auth:** API Key

### Templates

#### GET /api/v1/coupon-templates
**Lista todos los templates**

**Auth:** JWT

**Query params:**
- `active` (boolean): Filtrar por activos
- `scenario` (string): Filtrar por escenario

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "couponType": "PLUS30",
      "name": "1 mes gratis Plan Plus",
      "description": "1 mes gratis de EasyOrder Plus",
      "scenarios": ["bant_high", "first_contact", "high_intent"],
      "percentOff": 100,
      "durationMonths": 1,
      "trialDays": null,
      "messageTemplate": "¡Hola {{nombre}}!...",
      "mediaUrl": null,
      "maxPerUser": 1,
      "expiresHours": 48,
      "validFor": ["new_users"],
      "active": true,
      "priority": 10,
      "createdAt": "2026-03-17T10:00:00Z",
      "updatedAt": "2026-03-17T10:00:00Z"
    }
  ]
}
```

#### GET /api/v1/coupon-templates/:type
**Obtiene template específico**

**Auth:** JWT

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "couponType": "PLUS30",
    "name": "1 mes gratis Plan Plus",
    "description": "1 mes gratis de EasyOrder Plus",
    "scenarios": ["bant_high", "first_contact", "high_intent"],
    "percentOff": 100,
    "durationMonths": 1,
    "trialDays": null,
    "messageTemplate": "¡Hola {{nombre}}!...",
    "mediaUrl": null,
    "maxPerUser": 1,
    "expiresHours": 48,
    "validFor": ["new_users"],
    "active": true,
    "priority": 10
  }
}
```

#### POST /api/v1/coupon-templates
**Crea nuevo template**

**Auth:** JWT (Admin)

**Body:**
```json
{
  "couponType": "BLACKFRIDAY",
  "name": "70% descuento Black Friday",
  "description": "Oferta especial de Black Friday",
  "scenarios": ["seasonal", "high_intent"],
  "percentOff": 70,
  "durationMonths": 1,
  "messageTemplate": "¡Hola {{nombre}}! 🎉 BLACK FRIDAY: 70% de descuento\n\nCódigo: {{codigo}}\n\n👉 Actívalo: https://easyorder.mx/activate?code={{codigo}}\n\n⏰ Válido hasta el 30 de noviembre",
  "maxPerUser": 1,
  "expiresHours": 72,
  "validFor": ["new_users", "existing_users"],
  "priority": 15
}
```

**Campos obligatorios:**
- `couponType` (string): Código único del template
- `name` (string): Nombre descriptivo
- `messageTemplate` (string): Plantilla del mensaje WhatsApp

**Campos opcionales:**
- `description` (string): Descripción del cupón
- `scenarios` (array): Escenarios donde aplica
- `percentOff` (number 0-100): Porcentaje de descuento
- `durationMonths` (number): Duración en meses
- `trialDays` (number): Días de trial adicionales
- `mediaUrl` (string): URL de imagen/banner
- `maxPerUser` (number, default: 1): Máximo cupones por usuario
- `expiresHours` (number, default: 48): Horas hasta expiración
- `validFor` (array): Segmentos elegibles
- `priority` (number, default: 0): Prioridad de selección

#### PATCH /api/v1/coupon-templates/:type
**Actualiza template**

**Auth:** JWT (Admin)

**Body:** (todos los campos opcionales)
```json
{
  "percentOff": 80,
  "expiresHours": 96,
  "active": false
}
```

**Nota:** El campo `couponType` NO es editable (es el identificador único).

#### DELETE /api/v1/coupon-templates/:type
**Elimina template**

**Auth:** JWT (Admin)

**Response:**
```json
{
  "success": true,
  "message": "Template deleted successfully"
}
```

---

## Flujos de Uso

### Flujo 1: Cupón desde Agente de Voz

```
1. Agente ElevenLabs detecta BANT alto
2. Agente llama tool send_coupon
3. Tool → POST /coupons/generate-for-call
4. Backend:
   a. Selecciona template por scenario
   b. Verifica elegibilidad (max 1 por usuario)
   c. Genera código único
   d. Personaliza mensaje con datos del prospecto
   e. Retorna cupón + mensaje
5. Tool → POST baileys/api/messages/send
6. Baileys envía WhatsApp con cupón
7. Tool retorna a agente: "Cupón enviado"
```

### Flujo 2: Redención en Landing Page

```
1. Usuario recibe WhatsApp con link: easyorder.mx/cupon?code=EASY-PLUS30-A3F2X9
2. Landing page → POST /coupons/:code/visit (marca como visitado)
3. Usuario se registra
4. Landing page → POST /coupons/:code/redeem
5. Backend:
   a. Valida cupón (no expirado, no usado)
   b. Marca como CONVERTED
   c. Retorna configuración Stripe
6. Landing page → Stripe API (crea Promotion Code)
7. Stripe aplica descuento automáticamente
```

### Flujo 3: Campaña Masiva

```
1. Admin crea campaña en CRM
2. Admin → POST /coupons/bulk (genera 1000 cupones)
3. Admin → POST /campaigns/:id/start
4. Worker procesa contactos:
   a. Llama al agente
   b. Agente ofrece cupón
   c. Si acepta → asigna cupón del pool
   d. Envía por WhatsApp
```

---

## Integración con Agentes

### Tool Definition para ElevenLabs

```javascript
{
  name: "send_coupon",
  description: "Envía un cupón de descuento por WhatsApp al prospecto",
  parameters: {
    type: "object",
    properties: {
      prospect_phone: { 
        type: "string", 
        description: "Teléfono del prospecto (formato: 5215512345678)" 
      },
      prospect_name: { 
        type: "string", 
        description: "Nombre del prospecto" 
      },
      business_name: { 
        type: "string", 
        description: "Nombre del negocio" 
      },
      scenario: { 
        type: "string", 
        enum: ["bant_high", "price_objection", "trial_ending", "upgrade_interest"],
        description: "Escenario que dispara el cupón"
      }
    },
    required: ["prospect_phone", "prospect_name", "business_name", "scenario"]
  }
}
```

### Implementación de la Tool

```javascript
async function sendCoupon(params) {
  // 1. Generar cupón
  const response = await fetch(`${PARTNERS_API_URL}/coupons/generate-for-call`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': PARTNERS_API_KEY
    },
    body: JSON.stringify({
      phone: params.prospect_phone,
      prospectName: params.prospect_name,
      businessName: params.business_name,
      scenario: params.scenario,
      agentId: AGENT_ID,
      callId: CURRENT_CALL_ID
    })
  });
  
  const { data } = await response.json();
  
  // 2. Enviar por WhatsApp
  await fetch(`${BAILEYS_URL}/api/messages/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': BAILEYS_API_KEY
    },
    body: JSON.stringify({
      from: WHATSAPP_NUMBER,
      to: params.prospect_phone,
      message: data.message
    })
  });
  
  return {
    success: true,
    message: `Cupón ${data.coupon.code} enviado exitosamente`
  };
}
```

---

## Integración con Stripe

### Crear Promotion Code

```javascript
// En la landing page, después de redimir cupón
const { stripeConfig } = await redeemCoupon(code);

// Crear coupon en Stripe
const stripeCoupon = await stripe.coupons.create({
  percent_off: stripeConfig.percentOff,
  duration: 'repeating',
  duration_in_months: stripeConfig.durationMonths
});

// Crear promotion code
const promoCode = await stripe.promotionCodes.create({
  coupon: stripeCoupon.id,
  code: code, // EASY-PLUS30-A3F2X9
  max_redemptions: 1
});

// Aplicar al checkout
const session = await stripe.checkout.sessions.create({
  line_items: [...],
  discounts: [{
    promotion_code: promoCode.id
  }]
});
```

---

## Configuración

### Variables de Entorno

```env
# En partners-api
DATABASE_URL=postgresql://...
API_KEY=your-api-key-here

# En agentes ElevenLabs
PARTNERS_API_URL=https://partners-api.easyorder.mx
PARTNERS_API_KEY=your-api-key-here
BAILEYS_URL=https://baileys.easyorder.mx
BAILEYS_API_KEY=your-baileys-key-here

# En landing page
NEXT_PUBLIC_API_URL=https://partners-api.easyorder.mx
STRIPE_SECRET_KEY=sk_live_...
```

### Seed de Templates

```bash
# Cargar los 6 templates base
node prisma/seed-coupon-templates.js
```

---

## Métricas y Reportes

### Métricas por Cupón

```javascript
GET /api/v1/coupons/:id/stats

Response:
{
  "coupon": {
    "code": "EASY-PLUS30-A3F2X9",
    "status": "CONVERTED"
  },
  "campaign": {
    "id": "campaign-123",
    "name": "Campaña Zona Norte"
  },
  "metrics": {
    "totalContacts": 1,
    "visitCount": 3,
    "generatedAt": "2026-03-17T10:00:00Z",
    "sentAt": "2026-03-17T10:05:00Z",
    "visitedAt": "2026-03-17T12:00:00Z",
    "convertedAt": "2026-03-17T14:00:00Z"
  }
}
```

### Atribución

Cada cupón guarda:
- `source`: De dónde vino (agent_call, campaign, crm_chat)
- `agentId`: Qué agente lo generó
- `callId`: ID de la llamada
- `scenario`: Qué escenario lo disparó
- `assignedPhone`: A quién se asignó

Esto permite reportes como:
- Cupones generados por agente
- Tasa de conversión por escenario
- ROI por campaña

---

## Reglas de Negocio

1. **Máximo 1 cupón por usuario** (configurable en template)
2. **Expiración 48 horas** desde asignación (configurable)
3. **No acumulables** - Solo 1 cupón activo a la vez
4. **Solo para nuevos usuarios o upgrades** (validado en elegibilidad)
5. **Códigos únicos** - Sufijo random de 6 caracteres

---

## Troubleshooting

### Error: "User already received a coupon"

El usuario ya tiene un cupón del mismo tipo. Verificar con:
```bash
GET /api/v1/coupons/check-eligibility
```

### Error: "Coupon expired"

El cupón pasó las 48 horas. Generar uno nuevo.

### Error: "Template not found for scenario"

No hay template activo para ese escenario. Verificar templates:
```bash
GET /api/v1/coupon-templates?active=true
```

---

## Catálogo de Valores

### Scenarios (Escenarios de Disparo)

Define en qué momento del customer journey el agente debe ofrecer este cupón.

#### Valores Actuales en Seed

| Valor | Descripción | Cuándo Usar |
|-------|-------------|-------------|
| `bant_high` | BANT score alto | Prospecto calificado: Budget, Authority, Need, Timeline confirmados |
| `first_contact` | Primer contacto | Primera llamada/interacción con prospecto nuevo |
| `high_intent` | Alta intención de compra | Prospecto muestra interés claro en contratar |
| `price_objection` | Objeción de precio | Prospecto dice "está caro" o pregunta por descuentos |
| `trial_ending` | Trial terminando | Usuario en prueba gratis próximo a expirar |
| `active_free_user` | Usuario free activo | Usuario usando plan gratuito de forma activa |
| `upgrade_interest` | Interés en upgrade | Usuario actual quiere plan superior |
| `multiple_branches` | Múltiples sucursales | Prospecto tiene/planea varias ubicaciones |
| `referral` | Referido | Usuario refirió a otro cliente |
| `abandoned_conversation` | Conversación abandonada | Prospecto dejó conversación sin cerrar |
| `cold_lead` | Lead frío | Prospecto que no respondió después de contacto inicial |

#### Valores Adicionales Recomendados

| Valor | Descripción | Cuándo Usar |
|-------|-------------|-------------|
| `seasonal` | Campaña estacional | Black Friday, Navidad, Año Nuevo |
| `competitor_mention` | Menciona competidor | Prospecto compara con Rappi, Uber Eats, etc. |
| `feature_request` | Solicita feature específica | "¿Tienen integración con X?" |
| `budget_constraint` | Restricción de presupuesto | "Solo tengo $X al mes" |
| `decision_pending` | Decisión pendiente | "Lo voy a pensar" / "Necesito consultarlo" |
| `technical_concern` | Preocupación técnica | "¿Es difícil de usar?" / "¿Necesito internet?" |
| `onboarding_incomplete` | Onboarding incompleto | Usuario registrado pero no configuró todo |
| `low_usage` | Uso bajo | Usuario activo pero con poca actividad |
| `churn_risk` | Riesgo de cancelación | Usuario muestra señales de querer cancelar |

### ValidFor (Segmentos Elegibles)

Define qué tipo de usuarios pueden recibir/redimir este cupón.

#### Valores Actuales en Seed

| Valor | Descripción | Quiénes Califican |
|-------|-------------|-------------------|
| `new_users` | Usuarios nuevos | Nunca han tenido cuenta/suscripción |
| `trial_users` | Usuarios en trial | Actualmente en período de prueba |
| `upgrade` | Para upgrade | Usuarios actuales que quieren plan superior |
| `active_users` | Usuarios activos | Tienen suscripción activa pagada |

#### Valores Adicionales Recomendados

| Valor | Descripción | Quiénes Califican |
|-------|-------------|-------------------|
| `existing_users` | Usuarios existentes | Cualquier usuario con cuenta (activa o no) |
| `free_users` | Plan gratuito | Usuarios en plan free/básico |
| `plus_users` | Plan Plus | Usuarios con suscripción Plus |
| `pro_users` | Plan Pro | Usuarios con suscripción Pro |
| `churned_users` | Usuarios cancelados | Tuvieron suscripción pero cancelaron |
| `inactive_users` | Usuarios inactivos | No han usado la plataforma en X días |
| `high_value_users` | Alto valor | Usuarios con alto uso/facturación |
| `retention` | Retención | Usuarios en riesgo de cancelar |
| `reactivation` | Reactivación | Ex-usuarios para recuperar |
| `referrers` | Referidores | Usuarios que refieren a otros |
| `all_users` | Todos | Sin restricción de segmento |

---

## Integración con Campañas

### Uso de Templates en Wizard de Campañas

Cuando un usuario crea una campaña en el frontend, el **Paso 4: Agente y Oferta** debe:

1. **Cargar templates activos:**
```javascript
GET /api/v1/coupon-templates?active=true
```

2. **Mostrar combobox** con templates disponibles:
```
┌─────────────────────────────────────────────────────────────┐
│ Tipo de Cupón                                               │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ PLUS30 - 1 mes gratis Plan Plus                      ▼ │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ 50OFF - 50% descuento primer mes                        │ │
│ │ TRIAL14 - +14 días de prueba                            │ │
│ │ UPGRADEPRO - Upgrade a Pro                              │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

3. **Auto-llenar campos** al seleccionar template (snapshot):
```javascript
const handleTemplateSelect = (templateType) => {
  const template = templates.find(t => t.couponType === templateType);
  
  if (template) {
    setCampaignData({
      ...campaignData,
      couponPrefix: template.couponType,     // "PLUS30"
      offer: template.description,           // "1 mes gratis..."
      // NO guardamos templateId - es snapshot
    });
  }
};
```

4. **Crear campaña** con valores copiados:
```javascript
POST /api/v1/campaigns
{
  "couponPrefix": "PLUS30",    // ← Valor copiado del template
  "offer": "1 mes gratis..."   // ← Valor copiado del template
  // NO se envía templateId
}
```

### Comportamiento de Snapshot

**Importante:** Las campañas guardan una **copia (snapshot)** de los valores del template, NO una referencia.

```
Tiempo 1: Creas campaña
┌─────────────────┐           ┌─────────────────┐
│ CouponTemplate  │  COPIA    │ Campaign        │
│ PLUS30          │ ────────► │ couponPrefix:   │
│ "1 mes gratis"  │  VALORES  │   "PLUS30"      │
└─────────────────┘           │ offer:          │
                              │   "1 mes gratis"│
                              └─────────────────┘

Tiempo 2: Marketing edita template
┌─────────────────┐           ┌─────────────────┐
│ CouponTemplate  │           │ Campaign        │
│ PLUS30          │           │ couponPrefix:   │
│ "2 meses gratis"│ ← Cambió  │   "PLUS30"      │ ← NO cambió
└─────────────────┘           │ offer:          │
                              │   "1 mes gratis"│ ← NO cambió
                              └─────────────────┘
```

**Ventajas:**
- Campañas existentes mantienen consistencia
- Todos los contactos de una campaña reciben la misma oferta
- Auditoría clara de qué se prometió
- Métricas comparables por campaña

---

**Última actualización:** 25 de marzo de 2026
