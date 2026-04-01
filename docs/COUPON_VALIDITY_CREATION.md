# Creación de Cupones con Rango de Vida Personalizado

## 📋 Descripción

Al crear cupones, ahora puedes especificar un rango de vida personalizado mediante los campos `validFrom` y `validUntil`. Esto te permite controlar exactamente cuándo un cupón es válido.

---

## 🎯 Opciones de Configuración

### 1. **Usar Template de Cupón**

Si especificas un `couponTemplateId`, el sistema calculará automáticamente las fechas de validez basándose en la configuración del template (validFromHour, validUntilHour, validDays).

### 2. **Especificar Fechas Manualmente**

Puedes proporcionar `validFrom` y `validUntil` directamente para sobrescribir cualquier configuración del template.

### 3. **Sin Restricciones**

Si no especificas ni template ni fechas, el cupón no tendrá restricciones de validez temporal (será válido indefinidamente hasta que expire por `expiresAt`).

---

## 📡 Endpoints API

### Crear Cupón Individual

**POST** `/api/v1/coupons`

**Body:**
```json
{
  "campaignId": "uuid-de-campaña",
  "code": "WEEKEND50-ABC123",
  "offer": "50% de descuento en tu primera orden",
  "validFrom": "2026-03-28T17:00:00.000Z",
  "validUntil": "2026-03-30T21:00:00.000Z",
  "couponTemplateId": "uuid-del-template"
}
```

**Parámetros:**

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `campaignId` | String (UUID) | ✅ Sí | ID de la campaña |
| `offer` | String | ✅ Sí | Descripción de la oferta |
| `code` | String | ❌ No | Código del cupón (se genera automáticamente si no se proporciona) |
| `validFrom` | String (ISO 8601) | ❌ No | Fecha/hora de inicio de validez |
| `validUntil` | String (ISO 8601) | ❌ No | Fecha/hora de fin de validez |
| `couponTemplateId` | String (UUID) | ❌ No | ID del template para usar su configuración |

**Respuesta Exitosa (201):**
```json
{
  "success": true,
  "data": {
    "id": "uuid-del-cupon",
    "code": "WEEKEND50-ABC123",
    "offer": "50% de descuento en tu primera orden",
    "status": "GENERATED",
    "validFrom": "2026-03-28T17:00:00.000Z",
    "validUntil": "2026-03-30T21:00:00.000Z",
    "campaignId": "uuid-de-campaña",
    "createdAt": "2026-03-28T15:30:00.000Z"
  },
  "message": "Cupón creado exitosamente"
}
```

---

### Generar Cupones en Lote

**POST** `/api/v1/coupons/bulk`

**Body:**
```json
{
  "campaignId": "uuid-de-campaña",
  "count": 100,
  "offerTemplate": "20% de descuento",
  "validFrom": "2026-04-01T00:00:00.000Z",
  "validUntil": "2026-04-07T23:59:59.000Z",
  "couponTemplateId": "uuid-del-template"
}
```

**Parámetros:**

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `campaignId` | String (UUID) | ✅ Sí | ID de la campaña |
| `count` | Number | ✅ Sí | Cantidad de cupones a generar (1-1000) |
| `offerTemplate` | String | ✅ Sí | Plantilla de oferta para todos los cupones |
| `validFrom` | String (ISO 8601) | ❌ No | Fecha/hora de inicio de validez |
| `validUntil` | String (ISO 8601) | ❌ No | Fecha/hora de fin de validez |
| `couponTemplateId` | String (UUID) | ❌ No | ID del template para usar su configuración |

**Respuesta Exitosa (201):**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid-1",
      "code": "CAMPAIGN-A1B2C3D4",
      "offer": "20% de descuento",
      "status": "GENERATED",
      "validFrom": "2026-04-01T00:00:00.000Z",
      "validUntil": "2026-04-07T23:59:59.000Z",
      "campaignId": "uuid-de-campaña"
    },
    // ... 99 cupones más
  ],
  "message": "100 cupones generados exitosamente"
}
```

---

## 💡 Ejemplos de Uso

### Ejemplo 1: Cupón de Fin de Semana

Crear cupones válidos solo durante el fin de semana:

```javascript
const response = await fetch('/api/v1/coupons/bulk', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_TOKEN'
  },
  body: JSON.stringify({
    campaignId: 'campaign-123',
    count: 50,
    offerTemplate: '50% OFF - Solo Fin de Semana',
    validFrom: '2026-04-05T00:00:00.000Z', // Viernes 00:00
    validUntil: '2026-04-07T23:59:59.000Z'  // Domingo 23:59
  })
});
```

### Ejemplo 2: Cupón con Template

Usar configuración de template pero sobrescribir fechas:

```javascript
const response = await fetch('/api/v1/coupons', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_TOKEN'
  },
  body: JSON.stringify({
    campaignId: 'campaign-123',
    offer: 'Descuento especial',
    couponTemplateId: 'template-456', // Usa configuración del template
    validFrom: '2026-04-01T09:00:00.000Z', // Pero sobrescribe fechas
    validUntil: '2026-04-01T18:00:00.000Z'
  })
});
```

### Ejemplo 3: Cupón de Lanzamiento

Cupones válidos solo el día del lanzamiento:

```javascript
const response = await fetch('/api/v1/coupons/bulk', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_TOKEN'
  },
  body: JSON.stringify({
    campaignId: 'campaign-123',
    count: 200,
    offerTemplate: '30% OFF - Día de Lanzamiento',
    validFrom: '2026-05-01T00:00:00.000Z',
    validUntil: '2026-05-01T23:59:59.000Z'
  })
});
```

### Ejemplo 4: Cupón Happy Hour

Cupones válidos solo durante happy hour (5pm - 8pm):

```javascript
const response = await fetch('/api/v1/coupons/bulk', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_TOKEN'
  },
  body: JSON.stringify({
    campaignId: 'campaign-123',
    count: 100,
    offerTemplate: '2x1 en bebidas - Happy Hour',
    validFrom: '2026-04-10T17:00:00.000Z', // 5:00 PM
    validUntil: '2026-04-10T20:00:00.000Z'  // 8:00 PM
  })
});
```

---

## 🔄 Prioridad de Configuración

El sistema aplica la configuración en el siguiente orden de prioridad:

1. **Fechas manuales** (`validFrom`, `validUntil`) - Mayor prioridad
2. **Template de cupón** (`couponTemplateId`) - Prioridad media
3. **Sin restricciones** - Menor prioridad (cupón válido indefinidamente)

**Ejemplo de prioridad:**

```javascript
// Si envías esto:
{
  couponTemplateId: 'template-123', // Template dice: 9am-5pm
  validFrom: '2026-04-01T12:00:00.000Z', // Sobrescribe a 12pm
  validUntil: '2026-04-01T15:00:00.000Z'  // Sobrescribe a 3pm
}

// El cupón será válido de 12pm a 3pm (fechas manuales ganan)
```

---

## ✅ Validación Automática

El sistema valida automáticamente:

- ✅ `validFrom` debe ser anterior a `validUntil`
- ✅ Fechas deben estar en formato ISO 8601
- ✅ Si se proporciona template, debe existir en la base de datos
- ✅ Campaña debe existir y usuario debe tener permisos

---

## 🎨 Integración con Monitor

Los cupones creados con rango de vida personalizado aparecerán automáticamente en el monitor de cupones con:

- ⏱️ Contador en tiempo real del tiempo restante
- 🎨 Estados visuales (verde/naranja/rojo) según urgencia
- 📊 Estadísticas de cupones activos, por expirar y críticos
- 🔍 Filtros por estado y búsqueda

---

## 📝 Notas Importantes

1. **Formato de Fechas:** Siempre usa formato ISO 8601 (ejemplo: `2026-04-01T12:00:00.000Z`)

2. **Zona Horaria:** Las fechas se almacenan en UTC. Asegúrate de convertir desde tu zona horaria local.

3. **Compatibilidad:** Los cupones sin `validFrom`/`validUntil` siguen funcionando con el sistema legacy usando `expiresAt`.

4. **Actualización:** Una vez creado, el rango de vida del cupón NO puede modificarse. Debes crear un nuevo cupón.

5. **Monitor:** Los cupones aparecen en el monitor solo si tienen `validFrom` y `validUntil` configurados.

---

## 🚀 Casos de Uso Comunes

### Flash Sale (Venta Relámpago)
```json
{
  "validFrom": "2026-04-15T10:00:00.000Z",
  "validUntil": "2026-04-15T12:00:00.000Z"
}
```

### Promoción Semanal
```json
{
  "validFrom": "2026-04-01T00:00:00.000Z",
  "validUntil": "2026-04-07T23:59:59.000Z"
}
```

### Evento Especial
```json
{
  "validFrom": "2026-05-05T18:00:00.000Z",
  "validUntil": "2026-05-05T23:00:00.000Z"
}
```

### Campaña Mensual
```json
{
  "validFrom": "2026-04-01T00:00:00.000Z",
  "validUntil": "2026-04-30T23:59:59.000Z"
}
```

---

## 🔗 Recursos Relacionados

- [Sistema de Validez Temporal](./COUPON_VALIDITY_SYSTEM.md)
- [Monitor de Cupones](./COUPON_MONITOR_UI.md)
- [API de Cupones](../README.md#cupones)

---

**Versión:** 1.0.0  
**Última actualización:** 30 de Marzo, 2026  
**Autor:** Sistema de IA Cascade
