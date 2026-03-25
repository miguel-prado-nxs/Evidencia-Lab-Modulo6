# Estructura del Webhook para ElevenLabs

## Resumen

El webhook que ElevenLabs llama es:

```
POST https://partners-api-agentbuilder-dev.up.railway.app/api/v1/webhooks/coupons/generate-for-call
```

## Body del Webhook (Lo que ElevenLabs envía)

```json
{
  "phone": "523891087325",
  "prospectName": "Juan García",
  "businessName": "Restaurante El Sabor",
  "scenario": "closing",
  "agentId": "agent-uuid-123",
  "callId": "call-uuid-456",
  "campaignId": "campaign-uuid-789",
  "campaignContactId": "contact-uuid-abc",
  "couponType": "PLUS30"
}
```

## Parámetros Requeridos

| Parámetro | Tipo | Descripción | Ejemplo |
|-----------|------|-------------|---------|
| `phone` | string | Número de teléfono del prospecto con código de país | `523891087325` |
| `prospectName` | string | Nombre del prospecto | `Juan García` |
| `businessName` | string | Nombre del negocio/restaurante | `Restaurante El Sabor` |
| `scenario` | string | Escenario que dispara el cupón | `closing`, `price_objection`, `bant_high`, `trial_ending` |
| `agentId` | string | ID del agente ElevenLabs | `agent-uuid-123` |
| `callId` | string | ID de la llamada actual | `call-uuid-456` |

## Parámetros Opcionales

| Parámetro | Tipo | Descripción | Ejemplo |
|-----------|------|-------------|---------|
| `campaignId` | string | ID de la campaña (si es desde campaña) | `campaign-uuid-789` |
| `campaignContactId` | string | ID del contacto de campaña | `contact-uuid-abc` |
| `couponType` | string | Tipo específico de cupón | `PLUS30`, `50OFF` |

## Response Exitoso (201 Created)

```json
{
  "success": true,
  "data": {
    "coupon": {
      "id": "coupon-uuid-def",
      "code": "EASY-PLUS30-XYZ123",
      "offer": "+30 días gratis",
      "couponType": "PLUS30",
      "status": "SENT",
      "expiresAt": "2026-03-27T10:30:00Z",
      "sentAt": "2026-03-25T10:30:00Z"
    },
    "messageId": "3EB0E8F5F8E8F8E8F8E8F8E8",
    "fromPhone": "5218001234567"
  }
}
```

## Response con Error (400 Bad Request)

```json
{
  "success": false,
  "error": "No connected WhatsApp sessions available in Baileys"
}
```

## Flujo Interno en Partners API

```
1. Recibir parámetros del webhook
   ↓
2. Validar parámetros requeridos
   ↓
3. Generar cupón con couponGeneratorService
   ↓
4. Obtener sesión aleatoria conectada de Baileys
   ├─ GET /api/status en Baileys
   ├─ Filtrar sesiones con status "connected"
   └─ Seleccionar una al azar
   ↓
5. Renderizar mensaje con datos del cupón
   └─ Ejemplo: "¡Hola Juan García! Te ofrecemos 30 días gratis. Código: EASY-PLUS30-XYZ123"
   ↓
6. Enviar via Baileys
   └─ POST /api/messages/send
      {
        "from": "5218001234567",  // Sesión aleatoria
        "to": "523891087325",
        "message": "¡Hola Juan García! Te ofrecemos 30 días gratis. Código: EASY-PLUS30-XYZ123",
        "mediaUrl": "https://example.com/banner.jpg"
      }
   ↓
7. Actualizar cupón en BD
   ├─ status: SENT
   ├─ sentAt: timestamp
   ├─ sentFrom: 5218001234567
   └─ messageId: 3EB0E8F5F8E8F8E8F8E8F8E8
   ↓
8. Retornar respuesta a ElevenLabs
```

## Configuración en ElevenLabs

El webhook debe estar configurado con:

```json
{
  "type": "webhook",
  "name": "send_coupon_call",
  "description": "Genera un cupón personalizado para el prospecto y lo envía automáticamente por WhatsApp vía Baileys desde Partners API.",
  "api_schema": {
    "url": "https://partners-api-agentbuilder-dev.up.railway.app/api/v1/coupons/generate-for-call",
    "method": "POST",
    "request_body_schema": {
      "properties": [
        {
          "id": "phone",
          "type": "string",
          "required": true,
          "description": "Número de teléfono del prospecto con código de país"
        },
        {
          "id": "prospectName",
          "type": "string",
          "required": true,
          "description": "Nombre del prospecto"
        },
        {
          "id": "businessName",
          "type": "string",
          "required": true,
          "description": "Nombre del negocio"
        },
        {
          "id": "scenario",
          "type": "string",
          "required": true,
          "enum": ["closing", "price_objection", "bant_high", "trial_ending"],
          "description": "Escenario que dispara el cupón"
        },
        {
          "id": "agentId",
          "type": "string",
          "required": true,
          "description": "ID del agente"
        },
        {
          "id": "callId",
          "type": "string",
          "required": true,
          "description": "ID de la llamada"
        },
        {
          "id": "campaignId",
          "type": "string",
          "required": false,
          "description": "ID de la campaña (opcional)"
        },
        {
          "id": "campaignContactId",
          "type": "string",
          "required": false,
          "description": "ID del contacto de campaña (opcional)"
        },
        {
          "id": "couponType",
          "type": "string",
          "required": false,
          "description": "Tipo específico de cupón (opcional)"
        }
      ]
    }
  },
  "response_timeout_secs": 20
}
```

## Variables Disponibles en ElevenLabs (dynamic_variables)

Cuando la llamada se dispara desde una campaña, ElevenLabs recibe automáticamente:

```javascript
{
  // Información de campaña
  campaignId: "campaign-uuid",
  campaignName: "Campaña Primavera 2026",
  campaignOffer: "Descuento especial",
  
  // Información del contacto
  prospectName: "Juan García",
  businessName: "Restaurante El Sabor",
  phone: "523891087325",
  
  // Información del agente
  agentId: "agent-uuid",
  callId: "call-uuid",
  
  // Contexto de campaña (si hay cupones configurados)
  campaignContext: {
    coupons: {
      available: true,
      templates: [
        {
          type: "PLUS30",
          name: "+30 días gratis",
          applicableScenarios: ["closing", "price_objection"]
        }
      ]
    }
  },
  
  // Acceso rápido
  couponsAvailable: true,
  couponTypes: ["PLUS30", "50OFF"],
  couponSendEndpoint: "/api/v1/coupons/generate-for-call"
}
```

## Ejemplos de Uso en ElevenLabs

### Ejemplo 1: Cierre de Venta

```javascript
// En el prompt del agente o en una función personalizada
if (prospectInterested && scenario === "closing") {
  // Llamar webhook
  const response = await fetch(
    "https://partners-api-agentbuilder-dev.up.railway.app/api/v1/coupons/generate-for-call",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: phone,
        prospectName: prospectName,
        businessName: businessName,
        scenario: "closing",
        agentId: agentId,
        callId: callId,
        campaignId: campaignId,
        campaignContactId: campaignContactId,
        couponType: "PLUS30"
      })
    }
  );
  
  const result = await response.json();
  if (result.success) {
    // Confirmar al prospecto
    console.log(`Cupón enviado: ${result.data.coupon.code}`);
  }
}
```

### Ejemplo 2: Objeción de Precio

```javascript
if (priceObjection) {
  // Enviar cupón de descuento
  await fetch(
    "https://partners-api-agentbuilder-dev.up.railway.app/api/v1/coupons/generate-for-call",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: phone,
        prospectName: prospectName,
        businessName: businessName,
        scenario: "price_objection",
        agentId: agentId,
        callId: callId,
        couponType: "50OFF"  // Cupón de descuento
      })
    }
  );
}
```

## Manejo de Errores

### Error: "No connected WhatsApp sessions available in Baileys"
- **Causa:** No hay sesiones conectadas en Baileys
- **Solución:** Verificar que haya al menos una sesión conectada en Baileys

### Error: "Coupon not found"
- **Causa:** El cupón generado no se encontró en la BD
- **Solución:** Verificar que la BD esté funcionando correctamente

### Error: "Template not found for coupon type"
- **Causa:** El tipo de cupón no tiene template configurado
- **Solución:** Crear el template en la BD antes de usar ese tipo

## Notas Importantes

1. **Sin parámetro `from`:** El servicio selecciona una sesión aleatoria de Baileys
2. **Validación automática:** Partners API valida todos los parámetros requeridos
3. **Trazabilidad:** Se guarda `sentFrom` y `messageId` en la BD
4. **Rate limiting:** Implementar delays entre llamadas para evitar ban de WhatsApp
5. **Timeout:** El webhook tiene timeout de 20 segundos

## Testing

Puedes probar el webhook con curl:

```bash
curl -X POST https://partners-api-agentbuilder-dev.up.railway.app/api/v1/webhooks/coupons/generate-for-call \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "523891087325",
    "prospectName": "Juan García",
    "businessName": "Restaurante El Sabor",
    "scenario": "closing",
    "agentId": "test-agent",
    "callId": "test-call",
    "campaignId": "test-campaign",
    "campaignContactId": "test-contact"
  }'
```
