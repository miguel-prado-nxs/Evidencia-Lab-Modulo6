# Flujo Correcto de Envío de Cupones - Partners API + Baileys

## Arquitectura

```
┌─────────────────────┐
│   ElevenLabs        │
│   (Agente IA)       │
└──────────┬──────────┘
           │
           │ Llama webhook
           ▼
┌─────────────────────────────────────────┐
│   Partners API                          │
│   POST /api/v1/webhooks/coupons/        │
│        generate-for-call                │
│                                         │
│  1. Genera cupón                        │
│  2. Prepara mensaje                     │
│  3. Llama a Baileys API                 │
└──────────┬──────────────────────────────┘
           │
           │ Llama endpoint
           ▼
┌─────────────────────────────────────────┐
│   Baileys Service                       │
│   POST /api/messages/send               │
│                                         │
│  1. Obtiene sesión conectada (from)     │
│  2. Formatea JID (to@s.whatsapp.net)    │
│  3. Envía mensaje por WhatsApp          │
└──────────┬──────────────────────────────┘
           │
           ▼
    WhatsApp (Prospecto)
```

## Parámetros del Webhook (ElevenLabs → Partners API)

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
  "couponType": "PLUS30"
}
```

## Flujo en Partners API

```javascript
// 1. Recibir parámetros del webhook
POST /api/v1/webhooks/coupons/generate-for-call
{
  phone, prospectName, businessName, scenario, agentId, callId, ...
}

// 2. Generar cupón
const coupon = await couponGeneratorService.generateCouponForCall({
  phone,
  prospectName,
  businessName,
  scenario,
  agentId,
  callId,
  campaignId,
  campaignContactId,
  couponType
});

// 3. Renderizar mensaje con datos del cupón
const message = renderCouponMessage(template, coupon);
// Resultado: "¡Hola Juan García! Te ofrecemos 30 días gratis. Código: EASY-PLUS30-XXXX"

// 4. Llamar a Baileys para enviar
const baileyResult = await fetch('https://baileys-service/api/messages/send', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-KEY': BAILEYS_API_KEY
  },
  body: JSON.stringify({
    from: BAILEYS_FROM_PHONE,  // Número de WhatsApp conectado (ej: 5218001234567)
    to: phone,                  // Número destino (ej: 523891087325)
    message: message,           // Mensaje renderizado con código del cupón
    mediaUrl: template.mediaUrl // URL de imagen/banner (opcional)
  })
});

// 5. Actualizar cupón con estado SENT
await prisma.campaignCoupon.update({
  where: { id: coupon.id },
  data: {
    status: 'SENT',
    sentAt: new Date()
  }
});

// 6. Retornar respuesta a ElevenLabs
return {
  success: true,
  coupon: {
    id: coupon.id,
    code: coupon.code,
    offer: coupon.offer,
    status: 'SENT'
  },
  messageId: baileyResult.data.messageId
};
```

## Parámetros Clave

### De Partners API a Baileys

```json
{
  "from": "5218001234567",      // Número de WhatsApp conectado en Baileys
  "to": "523891087325",          // Número destino (prospecto)
  "message": "¡Hola Juan García! Te ofrecemos 30 días gratis. Código: EASY-PLUS30-XXXX",
  "mediaUrl": "https://example.com/banner.jpg",  // Opcional
  "mediaType": "image"           // Opcional
}
```

### Requisitos en Baileys

1. **Número `from` debe estar conectado:**
   - Debe existir una sesión activa en Baileys
   - Status debe ser `connected`
   - Se obtiene con `GET /api/status`

2. **Número `to` debe ser válido:**
   - Formato: 10 dígitos MX → convertir a `521XXXXXXXXXX`
   - Ejemplo: `1234567890` → `5211234567890`

3. **API Key de Baileys:**
   - Incluir en header `X-API-KEY`
   - Configurado en `.env` de Baileys

## Variables de Entorno en Partners API

```env
# Baileys Service
BAILEYS_URL=https://whatsapp-baileys.okcrm.mx
BAILEYS_API_KEY=T0Z612B-VYAWE4R5QPGD93NIX8SLM7HU
BAILEYS_FROM_PHONE=5218001234567  # Número de WhatsApp conectado en Baileys
```

## Respuesta de Baileys

```json
{
  "success": true,
  "data": {
    "key": {
      "id": "3EB0E8F5F8E8F8E8F8E8F8E8",
      "remoteJid": "523891087325@s.whatsapp.net",
      "fromMe": true,
      "timestamp": 1711353600
    },
    "status": "sent"
  }
}
```

## Manejo de Errores

### Error: "No active session found"
- **Causa:** El número `from` no está conectado en Baileys
- **Solución:** Verificar que el número esté registrado y conectado en Baileys

### Error: "Invalid phone number"
- **Causa:** Formato incorrecto del número destino
- **Solución:** Asegurar que sea 10 dígitos MX o con prefijo 52/521

### Error: "Rate limit exceeded"
- **Causa:** Demasiados mensajes enviados rápidamente
- **Solución:** Implementar delay entre envíos (mínimo 1-2 segundos)

## Flujo Completo de Ejemplo

```
1. ElevenLabs detecta cierre de venta
   └─ Llama webhook: POST /api/v1/coupons/generate-for-call
      {
        "phone": "523891087325",
        "prospectName": "Juan García",
        "businessName": "Restaurante El Sabor",
        "scenario": "closing",
        "agentId": "agent-123",
        "callId": "call-456"
      }

2. Partners API recibe webhook
   └─ Genera cupón: EASY-PLUS30-ABC123
   └─ Renderiza mensaje: "¡Hola Juan García! Te ofrecemos 30 días gratis. Código: EASY-PLUS30-ABC123"
   └─ Llama Baileys: POST /api/messages/send
      {
        "from": "5218001234567",
        "to": "523891087325",
        "message": "¡Hola Juan García! Te ofrecemos 30 días gratis. Código: EASY-PLUS30-ABC123",
        "mediaUrl": "https://example.com/banner.jpg"
      }

3. Baileys recibe solicitud
   └─ Obtiene sesión de 5218001234567
   └─ Formatea JID: 523891087325@s.whatsapp.net
   └─ Envía mensaje por WhatsApp
   └─ Retorna messageId

4. Partners API actualiza cupón
   └─ Status: SENT
   └─ sentAt: timestamp actual
   └─ Retorna respuesta a ElevenLabs

5. ElevenLabs recibe confirmación
   └─ Cupón enviado exitosamente
   └─ Prospecto recibe mensaje en WhatsApp
```

## Notas Importantes

1. **El número `from` debe estar conectado en Baileys**
   - No es automático, requiere autenticación previa
   - Se hace con código de emparejamiento en Baileys

2. **Baileys maneja la sesión de WhatsApp**
   - Partners API solo orquesta el flujo
   - No maneja directamente la conexión a WhatsApp

3. **Rate limiting**
   - WhatsApp puede banear por envío masivo
   - Implementar delays entre mensajes

4. **Formato de números mexicanos**
   - 10 dígitos: `1234567890` → `5211234567890`
   - Con 52: `521234567890` → `5211234567890`
   - Con 521: `5211234567890` → sin cambios

5. **Trazabilidad**
   - Guardar messageId de Baileys en BD
   - Permite rastrear entregas en WhatsApp
