# Configuración del Webhook para ElevenLabs - Envío de Cupones

## Descripción

Este webhook permite que ElevenLabs genere y envíe cupones automáticamente durante una llamada de campaña. El cupón se genera con los datos del prospecto y se envía inmediatamente por WhatsApp vía Baileys.

## Endpoint

```
POST https://partners-api-agentbuilder-dev.up.railway.app/api/v1/coupons/generate-for-call
```

## Configuración del Webhook en ElevenLabs

```json
{
  "type": "webhook",
  "name": "send_coupon_call",
  "description": "Genera un cupón personalizado para el prospecto y lo envía automáticamente por WhatsApp vía Baileys. Úsalo cuando el prospecto muestre interés o al cerrar la llamada.",
  "disable_interruptions": false,
  "force_pre_tool_speech": "auto",
  "tool_call_sound": null,
  "tool_call_sound_behavior": "auto",
  "tool_error_handling_mode": "auto",
  "execution_mode": "immediate",
  "api_schema": {
    "url": "https://partners-api-agentbuilder-dev.up.railway.app/api/v1/coupons/generate-for-call",
    "method": "POST",
    "path_params_schema": [],
    "query_params_schema": [],
    "request_body_schema": {
      "id": "body",
      "type": "object",
      "description": "Datos del prospecto para generar cupón y enviarlo por WhatsApp.",
      "properties": [
        {
          "id": "phone",
          "type": "string",
          "value_type": "llm_prompt",
          "description": "Número de teléfono del prospecto con código de país, ej: 523891087325",
          "dynamic_variable": "phone",
          "constant_value": null,
          "enum": null,
          "is_system_provided": false,
          "required": true
        },
        {
          "id": "prospectName",
          "type": "string",
          "value_type": "llm_prompt",
          "description": "Nombre del prospecto confirmado durante la llamada",
          "dynamic_variable": "prospectName",
          "constant_value": null,
          "enum": null,
          "is_system_provided": false,
          "required": true
        },
        {
          "id": "businessName",
          "type": "string",
          "value_type": "llm_prompt",
          "description": "Nombre del negocio o restaurante del prospecto",
          "dynamic_variable": "businessName",
          "constant_value": null,
          "enum": null,
          "is_system_provided": false,
          "required": true
        },
        {
          "id": "scenario",
          "type": "string",
          "value_type": "llm_prompt",
          "description": "Escenario que dispara el cupón: closing, price_objection, bant_high, trial_ending",
          "dynamic_variable": "scenario",
          "constant_value": null,
          "enum": [
            "closing",
            "price_objection",
            "bant_high",
            "trial_ending"
          ],
          "is_system_provided": false,
          "required": true
        },
        {
          "id": "agentId",
          "type": "string",
          "value_type": "llm_prompt",
          "description": "ID del agente que realiza la llamada",
          "dynamic_variable": "agentId",
          "constant_value": null,
          "enum": null,
          "is_system_provided": false,
          "required": true
        },
        {
          "id": "callId",
          "type": "string",
          "value_type": "llm_prompt",
          "description": "ID de la llamada actual de ElevenLabs",
          "dynamic_variable": "callId",
          "constant_value": null,
          "enum": null,
          "is_system_provided": false,
          "required": true
        },
        {
          "id": "campaignId",
          "type": "string",
          "value_type": "llm_prompt",
          "description": "ID de la campaña (opcional, viene en dynamic_variables si es llamada de campaña)",
          "dynamic_variable": "campaignId",
          "constant_value": null,
          "enum": null,
          "is_system_provided": false,
          "required": false
        },
        {
          "id": "campaignContactId",
          "type": "string",
          "value_type": "llm_prompt",
          "description": "ID del contacto de campaña (opcional, para trazabilidad)",
          "dynamic_variable": "campaignContactId",
          "constant_value": null,
          "enum": null,
          "is_system_provided": false,
          "required": false
        },
        {
          "id": "couponType",
          "type": "string",
          "value_type": "llm_prompt",
          "description": "Tipo específico de cupón (opcional, ej: PLUS30, 50OFF). Si no se especifica, se selecciona automáticamente según el scenario",
          "dynamic_variable": "couponType",
          "constant_value": null,
          "enum": null,
          "is_system_provided": false,
          "required": false
        }
      ],
      "required": true,
      "value_type": "llm_prompt"
    },
    "request_headers": [
      {
        "type": "secret",
        "name": "x-api-key",
        "value": "sdr_7jht0adywjd6sqt6gvibmzascrioyie7"
      }
    ],
    "content_type": "application/json",
    "auth_connection": null
  },
  "assignments": [],
  "response_timeout_secs": 20,
  "dynamic_variables": {
    "dynamic_variable_placeholders": {}
  },
  "response_mocks": []
}
```

## Parámetros Requeridos

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `phone` | string | ✅ | Número de teléfono con código de país (ej: 523891087325) |
| `prospectName` | string | ✅ | Nombre del prospecto |
| `businessName` | string | ✅ | Nombre del negocio/restaurante |
| `scenario` | string | ✅ | Escenario: closing, price_objection, bant_high, trial_ending |
| `agentId` | string | ✅ | ID del agente ElevenLabs |
| `callId` | string | ✅ | ID de la llamada actual |
| `campaignId` | string | ❌ | ID de la campaña (si viene de campaña) |
| `campaignContactId` | string | ❌ | ID del contacto de campaña (para trazabilidad) |
| `couponType` | string | ❌ | Tipo específico de cupón (PLUS30, 50OFF, etc.) |

## Parámetros Disponibles en Dynamic Variables (desde Campaña)

Cuando la llamada se dispara desde una campaña, ElevenLabs recibe automáticamente:

```javascript
{
  // Información de campaña
  campaignId: "uuid",
  campaignName: "Campaña Primavera 2026",
  campaignOffer: "Descuento especial",
  
  // Información del contacto
  prospectName: "Juan García",
  businessName: "Restaurante El Sabor",
  phone: "523891087325",
  
  // Información del agente
  agentId: "agent-uuid",
  callId: "call-uuid",
  
  // Contexto de campaña (SOLO si hay cupones configurados)
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
  couponSendEndpoint: "/api/v1/coupons-whatsapp/generate-and-send"
}
```

## Response

### Éxito (201 Created)

```json
{
  "success": true,
  "data": {
    "coupon": {
      "id": "coupon-uuid",
      "code": "EASY-PLUS30-XXXX",
      "offer": "+30 días gratis",
      "couponType": "PLUS30",
      "status": "SENT",
      "expiresAt": "2026-03-27T10:30:00Z",
      "sentAt": "2026-03-25T10:30:00Z"
    },
    "messageId": "message-id-from-baileys",
    "phone": "523891087325",
    "message": "Cupón generado y enviado exitosamente por WhatsApp"
  }
}
```

### Error (400 Bad Request)

```json
{
  "success": false,
  "error": "phone is required"
}
```

## Escenarios de Uso

### Escenario 1: Cierre de Venta
```
Agent: "Perfecto, te voy a enviar un cupón especial por WhatsApp"
[Llama webhook con scenario: "closing"]
→ Se envía cupón de bienvenida
```

### Escenario 2: Objeción de Precio
```
Prospect: "Es muy caro"
Agent: "Te ofrezco un descuento especial"
[Llama webhook con scenario: "price_objection"]
→ Se envía cupón de descuento
```

### Escenario 3: BANT Alto
```
Agent: [Detecta que el prospecto tiene presupuesto, autoridad, necesidad y timeline]
[Llama webhook con scenario: "bant_high"]
→ Se envía cupón premium
```

### Escenario 4: Trial Terminando
```
Agent: "Tu período de prueba está por terminar"
[Llama webhook con scenario: "trial_ending"]
→ Se envía cupón de extensión
```

## Instrucciones para ElevenLabs

1. **Extraer datos del prospecto** durante la llamada:
   - Nombre completo
   - Nombre del negocio
   - Número de teléfono

2. **Determinar el escenario** apropiado:
   - `closing`: Al cerrar la venta
   - `price_objection`: Si hay objeción de precio
   - `bant_high`: Si el prospecto tiene alto potencial
   - `trial_ending`: Si el trial está por terminar

3. **Llamar al webhook** con los datos:
   ```
   POST /api/v1/coupons/generate-for-call
   {
     "phone": "523891087325",
     "prospectName": "Juan García",
     "businessName": "Restaurante El Sabor",
     "scenario": "closing",
     "agentId": "agent-uuid",
     "callId": "call-uuid",
     "campaignId": "campaign-uuid",
     "campaignContactId": "contact-uuid"
   }
   ```

4. **Confirmar al prospecto** que recibirá el cupón por WhatsApp

## Manejo de Errores

| Error | Causa | Solución |
|-------|-------|----------|
| `phone is required` | Falta el número de teléfono | Confirmar número con el prospecto |
| `prospectName is required` | Falta el nombre | Pedir nombre al prospecto |
| `businessName is required` | Falta nombre del negocio | Pedir nombre del negocio |
| `scenario is required` | Falta el escenario | Especificar el escenario (closing, price_objection, etc.) |
| `agentId is required` | Falta ID del agente | Usar el ID del agente actual |
| `callId is required` | Falta ID de la llamada | Usar el ID de la llamada actual |

## Notas Importantes

1. **Solo desde Campañas**: El contexto de campaña y cupones solo está disponible cuando la llamada se dispara desde una campaña
2. **Validación Automática**: El sistema valida automáticamente que el prospecto sea elegible para el cupón
3. **Envío Inmediato**: El cupón se envía por WhatsApp inmediatamente después de generarse
4. **Trazabilidad**: Se registra automáticamente qué cupón se envió a quién y cuándo
5. **Expiración**: Cada cupón expira según la configuración del template (default: 48 horas)

## Testing

Puedes probar el webhook con curl:

```bash
curl -X POST https://partners-api-agentbuilder-dev.up.railway.app/api/v1/coupons/generate-for-call \
  -H "Content-Type: application/json" \
  -H "x-api-key: sdr_7jht0adywjd6sqt6gvibmzascrioyie7" \
  -d '{
    "phone": "523891087325",
    "prospectName": "Juan García",
    "businessName": "Restaurante El Sabor",
    "scenario": "closing",
    "agentId": "test-agent-id",
    "callId": "test-call-id",
    "campaignId": "test-campaign-id",
    "campaignContactId": "test-contact-id"
  }'
```

## Integración con Agent Builder

Si usas Agent Builder, el webhook ya está configurado en el sistema. Solo asegúrate de:

1. Pasar los parámetros correctos desde ElevenLabs
2. Usar los valores de `dynamic_variables` cuando estén disponibles
3. Manejar correctamente los errores de respuesta
