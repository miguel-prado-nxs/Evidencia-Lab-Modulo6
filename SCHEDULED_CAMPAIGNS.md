# Implementar Campaña Programada con ElevenLabs

## Resumen
ElevenLabs ya maneja la programación de llamadas a través del parámetro `scheduled_time_unix`. Solo necesitamos hacer cambios mínimos en tu backend para:
1. Guardar el fecha de programación en la BD (para auditoría/tracking)
2. Asegurar que `scheduledTimeUnix` se pase correctamente a ElevenLabs

---

## Cambios Necesarios

### 1. **Prisma Schema** - Agregar campo de auditoría
**Archivo**: `prisma/schema.prisma`

En el modelo `Campaign`, agregar después de `startedAt`:

```prisma
scheduledAt        DateTime?         @map("scheduled_at")
```

**Ubicación exacta** (línea 898 aprox):
```prisma
  startedAt         DateTime?         @map("started_at")
  scheduledAt       DateTime?         @map("scheduled_at")  // ← AGREGAR ESTA LÍNEA
  completedAt       DateTime?         @map("completed_at")
```

Luego ejecutar:
```bash
npx prisma migrate dev --name add_scheduled_at_to_campaign
```

---

### 2. **campaignsService.js** - Guardar la fecha de programación
**Archivo**: `src/services/campaignsService.js`
**Función**: `startCampaign()`
**Ubicación**: Alrededor de la línea 800 donde se actualiza la campaña

**Cambio en la línea 782-786** (aproximado):

```javascript
// ANTES:
await prisma.$transaction([
  prisma.campaign.update({
    where: { id: campaignId },
    data: {
      status: "ACTIVE",
      startedAt: new Date(),
    },
  }),
```

**DESPUÉS:**
```javascript
// DESPUÉS:
await prisma.$transaction([
  prisma.campaign.update({
    where: { id: campaignId },
    data: {
      status: "ACTIVE",
      startedAt: new Date(),
      scheduledAt: resolvedScheduledTimeUnix 
        ? new Date(resolvedScheduledTimeUnix * 1000)
        : null,  // Si no hay scheduledTime, stored null
    },
  }),
```

---

## Flujo Completo

### Crear Campaña
```
POST /api/v1/campaigns
{
  "name": "Mi Campaña",
  "description": "...",
  // ... otros campos
}
```
✅ Se crea en estado `DRAFT`

### Iniciar Campaña (Programada o Inmediata)
```
POST /api/v1/campaigns/:id/start
{
  "agentId": "agent_123",
  "scheduledTimeUnix": 1763330400,  // opcional
  "targetConcurrencyLimit": 10,
  "maxRecipientsPerRequest": 100
}
```

**Opciones:**
- **Sin `scheduledTimeUnix`**: Se inicia inmediatamente
- **Con `scheduledTimeUnix`**: Se programa en ElevenLabs y se guarda en `Campaign.scheduledAt`

### Backend - Qué pasa

1. **Se recibe `scheduledTimeUnix`** en `startCampaign()`
2. **Se normaliza** con `normalizeScheduledTimeUnix()` - valida que no esté en el pasado
3. **Se construyen `dynamic_variables`** de todos los contactos
4. **Se envía a ElevenLabs** con `scheduled_time_unix: resolvedScheduledTimeUnix`
5. **Se guarda `Campaign.scheduledAt`** convertido a DateTime
6. **Se actualiza campaña** a `ACTIVE`

### ElevenLabs - Qué pasa
```
ElevenLabs recibe:
{
  "scheduled_time_unix": 1763330400,
  "agent_id": "...",
  "phone_numbers": [...],
  "dynamic_variables": [...]
}
```

✅ ElevenLabs programa automáticamente las llamadas para esa fecha/hora

---

## Variables de Entorno (opcional)

Si necesitas configurar valores por defecto:

```env
ELEVENLABS_AGENT_PHONE_NUMBER_ID=xxx  # Requerido
ELEVENLABS_BATCH_MAX_RECIPIENTS_PER_REQUEST=100
ELEVENLABS_BATCH_TARGET_CONCURRENCY=10
```

---

## Testing

### Test 1: Campaña Inmediata
```bash
curl -X POST http://localhost:3001/api/v1/campaigns/:id/start \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "agentId": "agent_123"
  }'
```

Resultado esperado:
- `Campaign.status = "ACTIVE"`
- `Campaign.startedAt = NOW`
- `Campaign.scheduledAt = null`
- ElevenLabs lanza llamadas inmediatamente

### Test 2: Campaña Programada
```bash
curl -X POST http://localhost:3001/api/v1/campaigns/:id/start \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "agentId": "agent_123",
    "scheduledTimeUnix": 1763330400
  }'
```

Resultado esperado:
- `Campaign.status = "ACTIVE"`
- `Campaign.startedAt = NOW`
- `Campaign.scheduledAt = 2025-11-17 12:00:00` (convertido de Unix)
- ElevenLabs guarda la campaña programada para esa fecha

---

## Notas Importantes

⚠️ **`scheduledTimeUnix` debe estar en FUTURA**
- La función `normalizeScheduledTimeUnix()` rechaza fechas pasadas o muy cercanas
- Umbral actual: debe estar al menos 30 segundos en el futuro

⚠️ **ElevenLabs es el responsable de la programación**
- Tu backend solo guarda el dato para auditoría
- No necesitas crear un worker/cron para lanzar campañas
- ElevenLabs las lanza automáticamente

✅ **Campos de auditoría**
- `Campaign.startedAt` = Cuándo se inició en tu backend
- `Campaign.scheduledAt` = Cuándo ElevenLabs las lanzará (si está programada)

---

## Resumen de Cambios

| Archivo | Cambio | Línea |
|---------|--------|-------|
| `prisma/schema.prisma` | Agregar `scheduledAt DateTime?` | ~898 |
| `src/services/campaignsService.js` | Guardar `scheduledAt` al iniciar campaña | ~783 |

**Total**: 2 cambios mínimos + 1 migración de BD
