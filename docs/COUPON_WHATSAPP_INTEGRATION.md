# Integración de Cupones con WhatsApp (Baileys)

## Descripción General

Este documento describe cómo usar los nuevos endpoints para enviar cupones mediante WhatsApp usando el servicio Baileys.

## Endpoints Disponibles

### 1. Enviar Cupón Existente
**POST** `/api/v1/coupons-whatsapp/:couponId/send`

Envía un cupón ya generado mediante WhatsApp.

**Body:**
```json
{
  "phone": "523891087325",
  "from": "5218001234567" // Opcional: número remitente
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "couponId": "uuid",
    "phone": "523891087325",
    "messageId": "message-id-from-baileys"
  }
}
```

---

### 2. Enviar Múltiples Cupones a Contacto de Campaña
**POST** `/api/v1/coupons-whatsapp/campaign-contact/:campaignContactId/send-coupons`

Envía varios cupones a un contacto de campaña específico.

**Body:**
```json
{
  "couponIds": ["coupon-id-1", "coupon-id-2", "coupon-id-3"],
  "from": "5218001234567" // Opcional
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "campaignContactId": "uuid",
    "sent": 3,
    "failed": 0,
    "results": [
      {
        "couponId": "coupon-id-1",
        "success": true,
        "messageId": "msg-id-1"
      },
      {
        "couponId": "coupon-id-2",
        "success": true,
        "messageId": "msg-id-2"
      },
      {
        "couponId": "coupon-id-3",
        "success": true,
        "messageId": "msg-id-3"
      }
    ]
  }
}
```

---

### 3. Generar y Enviar Cupón en Una Operación
**POST** `/api/v1/coupons-whatsapp/generate-and-send`

Genera un nuevo cupón y lo envía inmediatamente por WhatsApp.

**Body:**
```json
{
  "phone": "523891087325",
  "prospectName": "Juan García",
  "businessName": "Restaurante El Sabor",
  "scenario": "closing",
  "agentId": "agent-uuid",
  "callId": "call-uuid",
  "campaignId": "campaign-uuid", // Opcional
  "campaignContactId": "contact-uuid", // Opcional
  "couponType": "PLUS30", // Opcional: tipo específico de cupón
  "from": "5218001234567" // Opcional
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "coupon": {
      "id": "coupon-uuid",
      "code": "EASY-PLUS30-XXXX",
      "offer": "+30 días gratis",
      "status": "SENT",
      "sentAt": "2026-03-25T10:30:00Z"
    },
    "messageId": "message-id-from-baileys"
  }
}
```

---

### 4. Reenviar Cupón Existente
**POST** `/api/v1/coupons-whatsapp/:couponId/resend`

Reenvía un cupón que ya fue generado a un número diferente.

**Body:**
```json
{
  "phone": "523891087325",
  "from": "5218001234567" // Opcional
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "couponId": "uuid",
    "phone": "523891087325",
    "messageId": "message-id-from-baileys"
  }
}
```

---

## Flujos de Uso

### Flujo 1: Campaña con Cupones Pre-generados
1. Crear campaña con `couponTemplateIds`
2. Generar cupones en bulk usando el servicio de cupones
3. Enviar cupones a contactos usando `/campaign-contact/:id/send-coupons`

### Flujo 2: Generación y Envío en Tiempo Real (Llamadas)
1. Durante una llamada de agente, llamar a `/generate-and-send`
2. Se genera el cupón automáticamente y se envía por WhatsApp
3. El cupón queda registrado en la BD con estado "SENT"

### Flujo 3: Reenvío de Cupones
1. Si un cupón no fue recibido, usar `/resend` para reenviarlo
2. Especificar el número de teléfono destino
3. El cupón se actualiza con la nueva fecha de envío

---

## Validación de Campañas

Antes de iniciar una campaña, validar que tenga cupones:

**GET** `/api/v1/campaigns/:id/validate-before-start`

**Response:**
```json
{
  "success": true,
  "data": {
    "isValid": true,
    "errors": []
  }
}
```

---

## Vista Previa de Envío

Ver qué se va a enviar antes de iniciar una campaña:

**GET** `/api/v1/campaigns/:id/send-preview`

**Response:**
```json
{
  "success": true,
  "data": {
    "campaign": {
      "id": "campaign-uuid",
      "name": "Campaña Primavera 2026",
      "status": "DRAFT",
      "totalContacts": 150,
      "totalCoupons": 0
    },
    "templates": {
      "selected": 2,
      "list": [
        {
          "id": "template-uuid",
          "couponType": "PLUS30",
          "name": "+30 días gratis",
          "description": "30 días adicionales sin costo",
          "percentOff": null,
          "durationMonths": 1,
          "trialDays": 30,
          "expiresHours": 48,
          "priority": 1
        }
      ],
      "validation": {
        "isValid": true,
        "warnings": [],
        "errors": [],
        "summary": "2 template(s) cargado(s). 0 error(es), 0 advertencia(s)"
      }
    },
    "messagePreview": {
      "sampleSize": 3,
      "samples": [
        {
          "contactId": "contact-uuid",
          "phone": "523891087325",
          "businessName": "Restaurante El Sabor",
          "prospectName": "Juan García",
          "messages": [
            {
              "templateId": "template-uuid",
              "couponType": "PLUS30",
              "templateName": "+30 días gratis",
              "preview": "¡Hola Juan! Te ofrecemos 30 días adicionales...",
              "fullMessage": "¡Hola Juan García! Desde Restaurante El Sabor te ofrecemos 30 días adicionales sin costo. Código: EASY-XXXX-XXXX",
              "offer": "30 días adicionales sin costo",
              "percentOff": null,
              "durationMonths": 1,
              "trialDays": 30,
              "expiresHours": 48,
              "mediaUrl": "https://example.com/banner.jpg"
            }
          ]
        }
      ]
    },
    "summary": {
      "totalContactsToReceive": 150,
      "totalTemplates": 2,
      "totalMessagesPerContact": 2,
      "estimatedTotalMessages": 300,
      "isReadyToSend": true
    }
  }
}
```

---

## Variables de Entorno Requeridas

```env
# Baileys WhatsApp Service
BAILEYS_URL=http://localhost:3000
BAILEYS_API_KEY=your-api-key
BAILEYS_FROM_PHONE=5218001234567 # Opcional: número remitente por defecto
```

---

## Manejo de Errores

### Errores Comunes

**Cupón no encontrado:**
```json
{
  "success": false,
  "error": "Coupon not found: coupon-uuid"
}
```

**Número de teléfono inválido:**
```json
{
  "success": false,
  "error": "No phone number for contact: contact-uuid"
}
```

**Servicio Baileys no disponible:**
```json
{
  "success": false,
  "error": "BAILEYS_URL not configured"
}
```

---

## Logging

Todos los envíos de cupones se registran en los logs con:
- ID del cupón
- Código del cupón
- Número de teléfono
- ID del mensaje (si fue exitoso)
- Errores (si ocurrieron)

---

## Integración con Campañas

### Crear Campaña con Templates de Cupones

**POST** `/api/v1/campaigns`

```json
{
  "name": "Campaña Primavera 2026",
  "description": "Campaña de adquisición con cupones",
  "type": "ACQUISITION",
  "centerLat": 25.6866,
  "centerLng": -100.3161,
  "radiusMeters": 5000,
  "activityCodes": ["5812"],
  "couponTemplateIds": ["template-uuid-1", "template-uuid-2"],
  "agentConfigId": "agent-uuid",
  "offer": "Descuento especial para nuevos clientes"
}
```

### Cargar Templates Después de Crear Campaña

**POST** `/api/v1/campaigns/:id/load-coupon-templates`

```json
{
  "couponTemplateIds": ["template-uuid-1", "template-uuid-2"]
}
```

---

## Notas Importantes

1. **Estado de Cupones**: Los cupones se actualizan automáticamente a "SENT" cuando se envían exitosamente
2. **Expiración**: Cada template define cuántas horas expira el cupón (default: 48h)
3. **Trazabilidad**: Se registra el ID del contacto de campaña para rastrear qué cupones se enviaron a quién
4. **Reintentos**: Si un envío falla, se puede reintentar usando el endpoint `/resend`
5. **Validación**: Siempre validar la campaña antes de iniciarla usando `/validate-before-start`
