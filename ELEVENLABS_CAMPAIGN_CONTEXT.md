# Integración de Contexto de Campaña con ElevenLabs

## ⚠️ IMPORTANTE

**El contexto de campaña y el envío de cupones SOLO se activan cuando la llamada se dispara desde una campaña.**

- Si la llamada viene de una campaña → ✅ Contexto disponible, cupones habilitados
- Si la llamada es independiente → ❌ Sin contexto de campaña, sin cupones

## Descripción General

Cuando una llamada se dispara desde una campaña, ElevenLabs tiene acceso completo al contexto de la campaña, incluyendo información sobre cupones disponibles, cuándo enviarlos y cómo hacerlo. El agente de IA puede consultar esta información durante la llamada y tomar decisiones sobre envío de cupones.

## Flujo de Integración

### 1. Contexto Pasado en Variables Dinámicas

Cuando se inicia una campaña, ElevenLabs recibe automáticamente el contexto de campaña en las `dynamic_variables`:

```javascript
dynamic_variables: {
  // Variables existentes
  campaignId: "uuid",
  campaignName: "Campaña Primavera 2026",
  campaignOffer: "Descuento especial",
  prospectName: "Juan García",
  businessName: "Restaurante El Sabor",
  
  // NUEVO: Contexto de campaña
  campaignContext: {
    campaignId: "uuid",
    campaignName: "Campaña Primavera 2026",
    campaignType: "ACQUISITION",
    campaignStatus: "ACTIVE",
    campaignOffer: "Descuento especial",
    
    // Información de cupones
    coupons: {
      available: true,
      templates: [
        {
          id: "template-uuid",
          type: "PLUS30",
          name: "+30 días gratis",
          description: "30 días adicionales sin costo",
          offer: "30 días",
          percentOff: null,
          durationMonths: 1,
          trialDays: 30,
          expiresHours: 48,
          applicableScenarios: ["closing", "price_objection"],
          messageTemplate: "¡Hola {{nombre}}! Te ofrecemos {{beneficio}}. Código: {{codigo}}",
          mediaUrl: "https://example.com/banner.jpg"
        }
      ],
      totalGenerated: 0,
      sendInstructions: {
        enabled: true,
        trigger: "Al final de la llamada si el prospecto muestra interés",
        method: "whatsapp",
        endpoint: "/api/v1/coupons-whatsapp/generate-and-send",
        requiredParams: ["phone", "prospectName", "businessName", "scenario", "agentId", "callId", "campaignId", "campaignContactId", "couponType"]
      }
    },
    
    // Instrucciones para el agente
    agentInstructions: "Eres un agente de ventas para la campaña: 'Campaña Primavera 2026'...",
    
    metadata: {
      createdAt: "2026-03-25T10:00:00Z",
      startedAt: "2026-03-25T10:30:00Z",
      agentConfigId: "agent-uuid",
      agentConfigName: "SDR Agent"
    }
  },
  
  // Acceso rápido a información de cupones
  couponsAvailable: true,
  couponTypes: ["PLUS30", "50OFF"],
  couponSendEndpoint: "/api/v1/coupons-whatsapp/generate-and-send",
  agentInstructions: "Instrucciones completas para el agente..."
}
```

### 2. Endpoints para Consultar Contexto

ElevenLabs puede consultar el contexto de campaña en cualquier momento durante la llamada:

#### Obtener Contexto Completo
**GET** `/api/v1/campaign-context?campaignId=uuid&campaignContactId=uuid`

```json
{
  "success": true,
  "data": {
    "campaignId": "uuid",
    "campaignName": "Campaña Primavera 2026",
    "campaignType": "ACQUISITION",
    "campaignStatus": "ACTIVE",
    "campaignOffer": "Descuento especial",
    "contactId": "contact-uuid",
    "establishmentName": "Restaurante El Sabor",
    "establishmentPhone": "523891087325",
    "coupons": {
      "available": true,
      "templates": [...],
      "totalGenerated": 0,
      "sendInstructions": {...}
    },
    "agentInstructions": "...",
    "metadata": {...}
  }
}
```

#### Obtener Instrucciones de Cupones
**GET** `/api/v1/campaign-context/coupon-instructions?campaignId=uuid`

```json
{
  "success": true,
  "data": {
    "campaignId": "uuid",
    "coupons": {
      "available": true,
      "templates": [
        {
          "id": "template-uuid",
          "type": "PLUS30",
          "name": "+30 días gratis",
          "description": "30 días adicionales sin costo",
          "offer": "30 días",
          "percentOff": null,
          "durationMonths": 1,
          "trialDays": 30,
          "expiresHours": 48,
          "applicableScenarios": ["closing", "price_objection"],
          "messageTemplate": "¡Hola {{nombre}}! Te ofrecemos {{beneficio}}. Código: {{codigo}}",
          "mediaUrl": "https://example.com/banner.jpg"
        }
      ],
      "sendInstructions": {
        "enabled": true,
        "trigger": "Al final de la llamada si el prospecto muestra interés",
        "method": "whatsapp",
        "endpoint": "/api/v1/coupons-whatsapp/generate-and-send",
        "requiredParams": [...]
      }
    },
    "instructions": "Instrucciones completas para el agente..."
  }
}
```

#### Obtener Templates de Cupones
**GET** `/api/v1/campaign-context/coupon-templates?campaignId=uuid`

```json
{
  "success": true,
  "data": {
    "campaignId": "uuid",
    "templates": [
      {
        "id": "template-uuid",
        "type": "PLUS30",
        "name": "+30 días gratis",
        "description": "30 días adicionales sin costo",
        "offer": "30 días",
        "percentOff": null,
        "durationMonths": 1,
        "trialDays": 30,
        "expiresHours": 48,
        "applicableScenarios": ["closing", "price_objection"],
        "messageTemplate": "¡Hola {{nombre}}! Te ofrecemos {{beneficio}}. Código: {{codigo}}",
        "mediaUrl": "https://example.com/banner.jpg"
      }
    ],
    "sendInstructions": {
      "enabled": true,
      "trigger": "Al final de la llamada si el prospecto muestra interés",
      "method": "whatsapp",
      "endpoint": "/api/v1/coupons-whatsapp/generate-and-send",
      "requiredParams": [...]
    }
  }
}
```

## Cómo ElevenLabs Usa el Contexto

### Escenario 1: Decisión Automática de Envío

El agente de ElevenLabs puede analizar la conversación y decidir automáticamente si enviar un cupón:

```
1. Durante la llamada, ElevenLabs tiene acceso a:
   - campaignContext.coupons.templates (tipos de cupones disponibles)
   - campaignContext.coupons.sendInstructions (cuándo enviar)
   - dynamic_variables.couponTypes (tipos disponibles)

2. Si el prospecto muestra interés (ej: "closing" scenario):
   - Selecciona el template más apropiado
   - Prepara los datos necesarios
   - Llama al endpoint de envío

3. El endpoint genera y envía el cupón automáticamente
```

### Escenario 2: Ofrecer Cupón al Final

El agente puede ofrecer explícitamente un cupón al final de la llamada:

```
Agent: "Como cliente especial, te ofrecemos un cupón exclusivo..."
Prospect: "Sí, me interesa"
Agent: [Envía cupón via /generate-and-send]
```

### Escenario 3: Cupón Condicional

El agente puede enviar diferentes cupones según el escenario:

```
- Si es "price_objection" → Enviar cupón de descuento (50OFF)
- Si es "trial_ending" → Enviar cupón de extensión (PLUS30)
- Si es "closing" → Enviar cupón de bienvenida
```

## Instrucciones para el Agente

Las instrucciones se incluyen automáticamente en `campaignContext.agentInstructions`:

```
Eres un agente de ventas para la campaña: "Campaña Primavera 2026"

Descripción: Campaña de adquisición con cupones especiales
Oferta: Descuento especial para nuevos clientes

CUPONES DISPONIBLES PARA ENVIAR:
- PLUS30 (+30 días gratis): 30 días adicionales sin costo
  Escenarios: closing, price_objection
  Beneficio: 1 meses 30 días trial

- 50OFF (50% descuento): 50% de descuento en primer mes
  Escenarios: price_objection
  Beneficio: 50%

AL FINAL DE LA LLAMADA: Si el prospecto está interesado, ofrece enviarle un cupón especial por WhatsApp.
Especifica qué tipo de cupón es más apropiado según el escenario de la conversación.
```

## Parámetros Requeridos para Envío

Cuando ElevenLabs envía un cupón, debe incluir estos parámetros:

```json
{
  "phone": "523891087325",
  "prospectName": "Juan García",
  "businessName": "Restaurante El Sabor",
  "scenario": "closing",
  "agentId": "agent-uuid",
  "callId": "call-uuid",
  "campaignId": "campaign-uuid",
  "campaignContactId": "contact-uuid",
  "couponType": "PLUS30",
  "from": "5218001234567" // Opcional
}
```

Todos estos datos están disponibles en las `dynamic_variables` pasadas a ElevenLabs.

## Flujo Completo de Envío

```
1. ElevenLabs recibe campaignContext en dynamic_variables
   ↓
2. Durante la llamada, analiza si debe enviar cupón
   ↓
3. Consulta campaignContext.coupons.templates para ver opciones
   ↓
4. Selecciona el template más apropiado según el escenario
   ↓
5. Llama a POST /api/v1/coupons-whatsapp/generate-and-send con:
   - phone (del prospecto)
   - prospectName (del prospecto)
   - businessName (del establecimiento)
   - scenario (closing, price_objection, etc.)
   - agentId (su ID)
   - callId (ID de la llamada)
   - campaignId (de dynamic_variables)
   - campaignContactId (de dynamic_variables)
   - couponType (tipo seleccionado)
   ↓
6. El cupón se genera automáticamente
   ↓
7. El cupón se envía por WhatsApp al prospecto
   ↓
8. El cupón se registra en la BD con estado "SENT"
```

## Variables Disponibles en Dynamic Variables

```javascript
// Información de campaña
campaignId
campaignName
campaignType
campaignOffer
campaignStatus

// Información del contacto
campaignContactId
prospectName
businessName
establishmentName
phoneNumber

// Información de cupones
couponsAvailable (boolean)
couponTypes (array)
couponSendEndpoint (string)
agentInstructions (string)

// Contexto completo
campaignContext (object con toda la información)
```

## Ejemplo de Integración en ElevenLabs

Si ElevenLabs tiene capacidad de hacer llamadas HTTP, puede:

```javascript
// 1. Consultar contexto de campaña
const context = await fetch(
  `/api/v1/campaign-context?campaignId=${campaignId}&campaignContactId=${campaignContactId}`
).then(r => r.json());

// 2. Analizar si debe enviar cupón
if (context.data.coupons.available && prospectInterested) {
  // 3. Seleccionar template apropiado
  const template = context.data.coupons.templates[0];
  
  // 4. Enviar cupón
  await fetch('/api/v1/coupons-whatsapp/generate-and-send', {
    method: 'POST',
    body: JSON.stringify({
      phone: prospectPhone,
      prospectName: prospectName,
      businessName: businessName,
      scenario: 'closing',
      agentId: agentId,
      callId: callId,
      campaignId: campaignId,
      campaignContactId: campaignContactId,
      couponType: template.type
    })
  });
}
```

## Notas Importantes

1. **Contexto en Variables**: El contexto se pasa automáticamente en `dynamic_variables` cuando se inicia la campaña
2. **Consultas en Tiempo Real**: ElevenLabs puede consultar los endpoints en cualquier momento durante la llamada
3. **Instrucciones Automáticas**: Las instrucciones se generan automáticamente basadas en los templates disponibles
4. **Envío Automático**: El endpoint `/generate-and-send` genera y envía el cupón en una sola operación
5. **Trazabilidad**: Todos los cupones enviados se registran con ID de campaña y contacto para tracking

## Troubleshooting

**El contexto no aparece en dynamic_variables:**
- Verificar que la campaña tenga `couponTemplateIds` configurados
- Verificar que los templates existan y estén activos

**El cupón no se envía:**
- Verificar que todos los parámetros requeridos estén presentes
- Verificar que el número de teléfono sea válido
- Verificar que Baileys esté configurado correctamente

**No hay instrucciones para el agente:**
- Verificar que la campaña tenga descripción y oferta
- Verificar que los templates tengan escenarios configurados
