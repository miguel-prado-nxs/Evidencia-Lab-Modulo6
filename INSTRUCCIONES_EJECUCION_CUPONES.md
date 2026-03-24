# Instrucciones de Ejecución - Sistema de Cupones

## 📋 Resumen

Se ha implementado el sistema completo de cupones con:
- ✅ Nuevos campos en `CampaignCoupon` para Stripe, tracking y atribución
- ✅ Nueva tabla `CouponTemplate` para plantillas editables
- ✅ Servicio `couponGeneratorService` con lógica de generación
- ✅ 3 nuevos endpoints para agentes y landing page
- ✅ Controlador y rutas para gestión de templates
- ✅ Seed con 6 tipos base de cupones de Marketing
- ✅ Documentación completa

---

## 🚀 Pasos para Aplicar

### 1. Aplicar Migración a la Base de Datos

La migración ya está actualizada en:
`prisma/migrations/20260310_add_campaigns_aligned/migration.sql`

**Ejecutar:**
```bash
node run-migration-direct.js
```

Este script ejecuta la migración de forma segura manejando duplicados.

### 2. Regenerar Cliente Prisma

Después de aplicar la migración:

```bash
npx prisma generate
```

Esto actualiza el cliente Prisma con los nuevos modelos.

### 3. Cargar Templates de Cupones

Cargar los 6 tipos base definidos por Marketing:

```bash
node prisma/seed-coupon-templates.js
```

**Templates que se cargarán:**
1. PLUS30 - 1 mes gratis Plan Plus
2. 50OFF - 50% descuento primer mes
3. TRIAL14 - +14 días de prueba
4. UPGRADEPRO - Pro al precio de Plus
5. REFER - Cupón referidos
6. COMEBACK - Recuperación lead

### 4. Verificar Instalación

Iniciar el servidor:

```bash
npm run dev
```

En otra terminal, ejecutar tests:

```bash
.\test-coupon-endpoints.ps1
```

**Debe mostrar:**
- ✅ 6 templates cargados
- ✅ Cupón generado exitosamente
- ✅ Cupón visitado
- ✅ Cupón redimido
- ✅ Validación de cupón ya usado

---

## 📝 Verificación Manual

### 1. Verificar Templates

```bash
curl http://localhost:3004/api/v1/coupon-templates \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Debe retornar 6 templates.

### 2. Generar Cupón de Prueba

```bash
curl http://localhost:3004/api/v1/coupons/generate-for-call \
  -X POST \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "phone": "5215512345678",
    "prospectName": "Carlos",
    "businessName": "La Taquería",
    "scenario": "bant_high",
    "agentId": "agent-123",
    "callId": "call-456"
  }'
```

Debe retornar un cupón con código `EASY-PLUS30-XXXXXX` y mensaje personalizado.

### 3. Verificar en Base de Datos

```sql
-- Ver templates
SELECT coupon_type, name, active FROM coupon_templates;

-- Ver cupones generados
SELECT code, coupon_type, status, assigned_phone 
FROM campaign_coupons 
ORDER BY created_at DESC 
LIMIT 10;
```

---

## 🔧 Troubleshooting

### Error: "relation coupon_templates does not exist"

La migración no se aplicó correctamente.

**Solución:**
```bash
# Verificar estado de migraciones
npx prisma migrate status

# Si está pendiente, aplicar
node run-migration-direct.js
```

### Error: "Cannot find module couponGeneratorService"

El servidor no se reinició después de crear los archivos.

**Solución:**
```bash
# Detener servidor (Ctrl+C)
# Reiniciar
npm run dev
```

### Error: "No active template found for scenario"

No hay templates cargados.

**Solución:**
```bash
node prisma/seed-coupon-templates.js
```

### Error: "User already received a coupon"

El usuario ya tiene un cupón de ese tipo (regla de negocio).

**Solución:**
- Usar otro teléfono para pruebas
- O cambiar `maxPerUser` en el template

---

## 📊 Estructura de Archivos Creados/Modificados

```
easyorder-partners-api/
├── prisma/
│   ├── schema.prisma                          [MODIFICADO]
│   ├── migrations/
│   │   └── 20260310_add_campaigns_aligned/
│   │       └── migration.sql                  [MODIFICADO]
│   └── seed-coupon-templates.js               [NUEVO]
│
├── src/
│   ├── services/
│   │   └── couponGeneratorService.js          [NUEVO]
│   ├── controllers/
│   │   ├── couponsController.js               [MODIFICADO]
│   │   └── couponTemplatesController.js       [NUEVO]
│   ├── routes/
│   │   ├── coupons.js                         [MODIFICADO]
│   │   └── couponTemplates.js                 [NUEVO]
│   └── app.js                                 [MODIFICADO]
│
├── docs/
│   └── COUPONS_SYSTEM.md                      [NUEVO]
│
├── test-coupon-endpoints.ps1                  [NUEVO]
├── COUPONS_IMPLEMENTATION_SUMMARY.md          [NUEVO]
└── INSTRUCCIONES_EJECUCION_CUPONES.md         [ESTE ARCHIVO]
```

---

## 🎯 Próximos Pasos (Otros Equipos)

### Para Dev de Agentes ElevenLabs

**Archivo:** `elevenlabs-sdr/src/webhooks/sendCoupon.ts`

```typescript
import { couponGeneratorService } from './services/couponGenerator';

export async function sendCoupon(params: {
  prospect_phone: string;
  prospect_name: string;
  business_name: string;
  scenario: string;
}) {
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
      agentId: process.env.AGENT_ID,
      callId: getCurrentCallId()
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
  
  return { success: true, code: data.coupon.code };
}
```

### Para (Landing Page)

**Archivo:** `easyorder-landing-page/src/app/cupon/page.tsx`

```typescript
async function redeemCoupon(code: string) {
  // 1. Redimir cupón
  const response = await fetch(`${API_URL}/coupons/${code}/redeem`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY
    },
    body: JSON.stringify({
      userData: {
        userId: currentUser.id,
        email: currentUser.email
      }
    })
  });
  
  const { data } = await response.json();
  
  // 2. Crear Promotion Code en Stripe
  const stripeCoupon = await stripe.coupons.create({
    percent_off: data.stripeConfig.percentOff,
    duration: 'repeating',
    duration_in_months: data.stripeConfig.durationMonths
  });
  
  const promoCode = await stripe.promotionCodes.create({
    coupon: stripeCoupon.id,
    code: code,
    max_redemptions: 1
  });
  
  // 3. Aplicar al checkout
  // ...
}
```

### Para Frontend (CRM)

**Archivo:** `web-easyorder-ventas/src/components/campaigns/CampaignWizard.tsx`

Actualizar Paso 4 con campos estructurados:

```tsx
<Select name="couponType" label="Tipo de Cupón">
  <option value="PLUS30">1 mes gratis (EASY-PLUS30)</option>
  <option value="50OFF">50% primer mes (EASY-50OFF)</option>
  <option value="TRIAL14">+14 días trial (EASY-TRIAL14)</option>
  <option value="UPGRADEPRO">Pro al precio de Plus (EASY-UPGRADEPRO)</option>
</Select>

<Input name="percentOff" type="number" label="% Descuento" />
<Input name="durationMonths" type="number" label="Duración (meses)" />
```

---

**Última actualización:** 17 de marzo de 2026  
**Versión:** 1.0.0
