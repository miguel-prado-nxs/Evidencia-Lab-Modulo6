# Sistema de Validez Temporal de Cupones

## Descripción General

Sistema completo para gestionar la validez temporal de cupones con rangos de fecha/hora, restricciones de horario y días de la semana, con contador en tiempo real para monitoreo.

## Características

### 1. Validez por Rango de Fechas/Horas

Cada cupón puede tener:
- **`validFrom`**: Fecha/hora desde cuándo es válido
- **`validUntil`**: Fecha/hora hasta cuándo es válido
- **`expiresAt`**: Campo legacy (compatibilidad con sistema anterior)

### 2. Restricciones de Horario en Templates

Los templates de cupones pueden definir restricciones por defecto:
- **`validFromHour`**: Hora de inicio (0-23)
- **`validUntilHour`**: Hora de fin (0-23)
- **`validDays`**: Días de la semana válidos (`["monday", "tuesday", ...]`)

### 3. Validación en Tiempo Real

El sistema calcula automáticamente:
- Si el cupón es válido en este momento
- Tiempo restante hasta expiración
- Razón de invalidez (si aplica)

## Estructura de Base de Datos

### Tabla: `coupon_templates`

```sql
ALTER TABLE "coupon_templates" 
ADD COLUMN "valid_from_hour" INTEGER,
ADD COLUMN "valid_until_hour" INTEGER,
ADD COLUMN "valid_days" TEXT[] DEFAULT '{}';
```

**Ejemplo:**
```javascript
{
  couponType: "HAPPY_HOUR_20",
  validFromHour: 17,      // 5:00 PM
  validUntilHour: 21,     // 9:00 PM
  validDays: ["friday", "saturday"],
  expiresHours: 48
}
```

### Tabla: `campaign_coupons`

```sql
ALTER TABLE "campaign_coupons"
ADD COLUMN "valid_from" TIMESTAMP(3),
ADD COLUMN "valid_until" TIMESTAMP(3);
```

**Ejemplo:**
```javascript
{
  code: "WEEKEND50-ABC123",
  validFrom: "2026-03-28T17:00:00.000Z",
  validUntil: "2026-03-30T21:00:00.000Z",
  status: "SENT"
}
```

## API Endpoints

### 1. Obtener Cupones Activos con Tiempo Restante

**GET** `/api/v1/coupons/active-with-time?campaignId={id}`

**Respuesta:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "code": "WEEKEND50-ABC123",
      "offer": "50% descuento",
      "status": "SENT",
      "validFrom": "2026-03-28T17:00:00.000Z",
      "validUntil": "2026-03-30T21:00:00.000Z",
      "validity": {
        "isValid": true,
        "timeRemaining": 172800000,
        "timeRemainingFormatted": "2d 0h",
        "expiresAt": "2026-03-30T21:00:00.000Z"
      }
    }
  ],
  "count": 1,
  "timestamp": "2026-03-28T18:30:00.000Z"
}
```

### 2. Validar Cupón para Uso

**GET** `/api/v1/coupons/validate/{code}`

**Respuesta (válido):**
```json
{
  "success": true,
  "data": {
    "valid": true,
    "coupon": { ... },
    "validity": {
      "isValid": true,
      "timeRemaining": 86400000,
      "timeRemainingFormatted": "1d 0h",
      "expiresAt": "2026-03-29T18:30:00.000Z"
    }
  }
}
```

**Respuesta (expirado):**
```json
{
  "success": false,
  "data": {
    "valid": false,
    "reason": "Cupón expirado",
    "coupon": { ... },
    "validity": {
      "isValid": false,
      "reason": "Cupón expirado",
      "expiredAt": "2026-03-28T18:00:00.000Z"
    }
  }
}
```

### 3. Marcar Cupones Expirados

**POST** `/api/v1/coupons/mark-expired`

**Respuesta:**
```json
{
  "success": true,
  "data": {
    "expiredCount": 15
  },
  "message": "15 cupones marcados como expirados"
}
```

## Uso en Código

### Generar Cupón con Validez Temporal

```javascript
const validityService = require('./services/couponValidityService');

// Obtener template
const template = await prisma.couponTemplate.findUnique({
  where: { couponType: "HAPPY_HOUR_20" }
});

// Calcular fechas de validez
const { validFrom, validUntil, expiresAt } = 
  validityService.calculateCouponValidityDates(template);

// Crear cupón
const coupon = await prisma.campaignCoupon.create({
  data: {
    code: "HAPPY20-XYZ",
    offer: "20% descuento",
    couponType: template.couponType,
    validFrom,
    validUntil,
    expiresAt,
    assignedAt: new Date(),
    status: "GENERATED"
  }
});
```

### Validar Cupón Antes de Usar

```javascript
const validityService = require('./services/couponValidityService');

// Obtener cupón
const coupon = await prisma.campaignCoupon.findUnique({
  where: { code: "HAPPY20-XYZ" }
});

// Validar
const validity = validityService.checkCouponValidity(coupon);

if (!validity.isValid) {
  console.log(`Cupón inválido: ${validity.reason}`);
  return;
}

console.log(`Tiempo restante: ${validity.timeRemainingFormatted}`);
// Proceder con el uso del cupón
```

### Enriquecer Cupones con Validez

```javascript
const validityService = require('./services/couponValidityService');

// Obtener cupones
const coupons = await prisma.campaignCoupon.findMany({
  where: { status: { in: ["SENT", "VISITED"] } }
});

// Enriquecer con validez
const enrichedCoupons = coupons.map(
  validityService.enrichCouponWithValidity
);

// Filtrar solo válidos
const validCoupons = enrichedCoupons.filter(c => c.validity.isValid);
```

## Tarea Programada (Cron Job)

Para marcar cupones expirados automáticamente, configurar un cron job:

```javascript
const cron = require('node-cron');
const couponService = require('./services/couponService');

// Ejecutar cada hora
cron.schedule('0 * * * *', async () => {
  const count = await couponService.markExpiredCoupons();
  console.log(`Marked ${count} coupons as expired`);
});
```

## Formato de Tiempo Restante

El sistema formatea el tiempo restante automáticamente:

| Tiempo Restante | Formato |
|----------------|---------|
| 2 días 5 horas | `2d 5h` |
| 5 horas 30 min | `5h 30m` |
| 30 min 45 seg  | `30m 45s` |
| 45 segundos    | `45s` |
| Expirado       | `Expirado` |

## Ejemplos de Uso

### Cupón con Horario de Happy Hour

```javascript
// Template
{
  couponType: "HAPPY_HOUR_30",
  name: "Happy Hour 30% OFF",
  validFromHour: 17,  // 5:00 PM
  validUntilHour: 21, // 9:00 PM
  validDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
  expiresHours: 168   // 7 días
}

// Cupón generado
{
  code: "HAPPY30-ABC",
  validFrom: "2026-03-28T17:00:00Z",
  validUntil: "2026-04-04T21:00:00Z"
}
```

### Cupón de Fin de Semana

```javascript
// Template
{
  couponType: "WEEKEND_50",
  name: "Weekend Special 50% OFF",
  validDays: ["saturday", "sunday"],
  expiresHours: 48
}

// Cupón generado el viernes
{
  code: "WEEKEND50-XYZ",
  validFrom: "2026-03-29T00:00:00Z",  // Sábado 00:00
  validUntil: "2026-03-30T23:59:59Z"  // Domingo 23:59
}
```

### Cupón con Validez Limitada

```javascript
// Cupón flash de 2 horas
{
  code: "FLASH2H-123",
  validFrom: "2026-03-28T18:00:00Z",
  validUntil: "2026-03-28T20:00:00Z",
  offer: "Flash sale 70% OFF"
}
```

## Monitor en Tiempo Real

Para implementar un monitor con contador en tiempo real en el frontend:

```javascript
// Obtener cupones activos
const response = await fetch('/api/v1/coupons/active-with-time');
const { data: coupons } = await response.json();

// Actualizar cada segundo
setInterval(() => {
  coupons.forEach(coupon => {
    const now = new Date();
    const expiresAt = new Date(coupon.validity.expiresAt);
    const timeRemaining = expiresAt - now;
    
    if (timeRemaining <= 0) {
      coupon.validity.timeRemainingFormatted = "Expirado";
      coupon.validity.isValid = false;
    } else {
      coupon.validity.timeRemainingFormatted = formatTime(timeRemaining);
    }
  });
  
  // Actualizar UI
  updateCouponDisplay(coupons);
}, 1000);
```

## Ventajas del Sistema

1. **Validación en Tiempo Real**: Calcula validez al momento de consulta
2. **Flexible**: Soporta múltiples tipos de restricciones
3. **Automático**: Marca cupones expirados sin intervención manual
4. **Escalable**: Funciona con miles de cupones simultáneos
5. **Compatible**: Mantiene compatibilidad con sistema anterior (`expiresAt`)

## Migración desde Sistema Anterior

El sistema es compatible con cupones existentes que solo tienen `expiresAt`:

```javascript
// Cupón legacy
{
  code: "OLD-COUPON",
  expiresAt: "2026-03-30T00:00:00Z"
  // validFrom y validUntil son null
}

// El sistema de validez lo maneja correctamente
const validity = checkCouponValidity(coupon);
// Usa expiresAt si validUntil no existe
```

## Próximos Pasos

1. ✅ Schema de base de datos actualizado
2. ✅ Servicio de validez implementado
3. ✅ Endpoints API creados
4. ✅ Documentación completa
5. ⏳ Aplicar migración SQL
6. ⏳ Implementar monitor en frontend
7. ⏳ Configurar cron job para expiración automática
8. ⏳ Testing end-to-end
