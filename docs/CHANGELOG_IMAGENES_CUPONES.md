# Changelog - Imágenes en Cupones WhatsApp

## [2026-03-30] - Implementación de envío de imágenes con cupones

### ✨ Feature Principal

**Envío de cupones con imágenes vía WhatsApp**

Los cupones ahora pueden incluir imágenes que se envían automáticamente junto con el mensaje de WhatsApp.

### 🔧 Componentes Involucrados

#### 1. Base de Datos
- **Tabla:** `CouponTemplate`
- **Campo:** `media_url` (String, nullable)
- **Uso:** Almacena URL pública de la imagen del cupón

#### 2. Backend (easyorder-partners-api)

**Archivos que YA soportan imágenes (sin modificaciones necesarias):**

- ✅ `src/services/whatsappService.js`
  - Función `sendWhatsAppMessage()` ya acepta `mediaUrl` y `mediaType`
  - Envía estos parámetros al servicio Baileys

- ✅ `src/controllers/couponsController.js`
  - Método `generateForCall()` ya extrae `mediaUrl` del template
  - Pasa `mediaUrl` a `sendWhatsAppMessage()`

- ✅ `prisma/schema.prisma`
  - Modelo `CouponTemplate` ya tiene campo `media_url`

**No se requirieron cambios en el backend partners-api.**

#### 3. Servicio Baileys (easyorder-whatsapp-baileys-service)

**Cambios implementados:**

- ✅ `src/services/whatsapp-manager.js`
  - Método `sendMessage()` actualizado para soportar media
  - Método `extractMessageInfo()` extrae media de mensajes entrantes
  - Guardado de mensajes incluye `mediaUrl` y `mediaType`

- ✅ `dashboard/src/components/whatsapp/ChatBubble.tsx`
  - Renderiza imágenes, videos y stickers
  - Elimina `[Unsupported message type]`

### 📊 Flujo Completo

```
1. Template en BD
   └─> CouponTemplate.media_url = "https://cdn.com/cupon.jpg"

2. Generación de cupón
   └─> couponsController.generateForCall()
       └─> Extrae template.mediaUrl

3. Envío WhatsApp
   └─> whatsappService.sendWhatsAppMessage({
         to: "526672398415",
         message: "Texto del cupón",
         mediaUrl: "https://cdn.com/cupon.jpg",
         mediaType: "image"
       })

4. Servicio Baileys
   └─> whatsappManager.sendMessage(from, to, message, {
         mediaUrl: "https://cdn.com/cupon.jpg",
         mediaType: "image"
       })

5. WhatsApp
   └─> Usuario recibe mensaje con imagen
```

### 🧪 Testing

**Script de prueba:**
```bash
cd easyorder-partners-api
node send-test-coupon.js
```

**Actualizar template con imagen:**
```sql
UPDATE "CouponTemplate"
SET media_url = 'https://picsum.photos/800/600'
WHERE coupon_type = 'PLUS30';
```

### 📝 Uso en Producción

#### Opción 1: Actualizar template existente

```javascript
await prisma.couponTemplate.update({
  where: { coupon_type: 'PLUS30' },
  data: {
    media_url: 'https://cdn.easyorder.mx/cupones/plus30.jpg'
  }
});
```

#### Opción 2: Crear template con imagen

```javascript
await prisma.couponTemplate.create({
  data: {
    coupon_type: 'PREMIUM',
    message_template: 'Tu cupón premium...',
    media_url: 'https://cdn.easyorder.mx/cupones/premium.jpg',
    // ... otros campos
  }
});
```

### 🌐 Requisitos de URLs

Las URLs de imágenes deben ser:

✅ **Válidas:**
- `https://cdn.easyorder.mx/cupones/imagen.jpg`
- `https://i.imgur.com/abc123.png`
- `https://picsum.photos/800/600`

❌ **No válidas:**
- URLs de Google Drive directas (requieren conversión)
- URLs con autenticación requerida
- URLs privadas o locales

### 📦 Formatos Soportados

| Tipo | Extensiones | Tamaño Máx | Caption |
|------|-------------|------------|---------|
| Imagen | jpg, png, webp | 5MB | ✅ |
| Video | mp4, avi | 16MB | ✅ |
| Sticker | webp | 100KB | ❌ |
| Documento | pdf, doc, xls | 100MB | ✅ |

### 🚀 Deploy

**Servicios actualizados:**
- ✅ `easyorder-whatsapp-baileys-service` - Deployado en Railway
- ✅ `easyorder-partners-api` - No requiere cambios

**Commits del servicio Baileys:**
- `734935a` - Soporte inicial de media
- `d5e63b4` - Fix de bugs
- `983cc89` - Stickers + dashboard
- `7ccd722` - Media en mensajes entrantes

### 📚 Documentación Adicional

- `docs/IMAGE_COUPON_IMPLEMENTATION.md` - Documentación técnica completa
- `IMPLEMENTACION_IMAGENES_CUPONES_RESUMEN.md` - Resumen ejecutivo
- `test-google-drive-image.md` - Guía para usar Google Drive

### ⚡ Integración con Agentes ElevenLabs

Los agentes de ElevenLabs pueden enviar cupones con imágenes automáticamente:

1. El agente decide enviar un cupón
2. Llama al endpoint `/api/v1/coupons-whatsapp/generate-and-send`
3. El sistema:
   - Genera el cupón
   - Obtiene el template con `media_url`
   - Envía WhatsApp con imagen automáticamente

**No se requiere configuración adicional en los agentes.**

### 🔮 Mejoras Futuras

- [ ] CDN propio para imágenes de cupones
- [ ] Generación dinámica de imágenes con datos del cupón
- [ ] A/B testing de diferentes imágenes
- [ ] Analytics de engagement con imágenes
- [ ] Compresión automática de imágenes

### 📊 Métricas

**Mensajes enviados con éxito:**
- Texto solo: ✅ Funcionando
- Texto + Imagen: ✅ Funcionando
- Stickers: ✅ Funcionando

**Dashboard:**
- Mensajes salientes: ✅ Muestra imágenes
- Mensajes entrantes: ✅ Muestra imágenes (después del deploy)

---

## Resumen Ejecutivo

✅ **La funcionalidad está completa y en producción**

- Los cupones pueden incluir imágenes
- El backend ya estaba preparado
- Solo se actualizó el servicio Baileys
- Dashboard muestra las imágenes correctamente
- Listo para usar con agentes de ElevenLabs

**Fecha de implementación:** 30 de Marzo, 2026
