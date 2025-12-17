# Ejemplos de uso - Calendly Meeting API

## 1. Crear meeting con Calendly

### Request:
```bash
curl -X POST "http://localhost:3004/api/v1/geo/meetings/{establishmentId}/calendly" \
  -H "X-Service-Key: ventas-easyorder-2024" \
  -H "Content-Type: application/json" \
  -d '{
    "startTime": "2025-12-19T12:00:00-07:00",
    "endTime": "2025-12-19T12:30:00-07:00",
    "notes": "Cliente interesado en optimizar su restaurante con tecnología"
  }'
```

### Nota sobre fechas:
El formato debe ser ISO 8601 con timezone. Ejemplos:
- `"2025-12-19T12:00:00-07:00"` (Zona horaria Pacífico, MST)
- `"2025-12-19T14:00:00-06:00"` (Zona horaria Central)
- `"2025-12-19T19:00:00Z"` (UTC)

Para México (Mazatlán):
- Usa `-07:00` para horario de verano
- Usa `-08:00` para horario estándar

### JavaScript/TypeScript ejemplo:
```typescript
// Crear fecha con timezone
const meetingDate = new Date("2025-12-19T12:00:00");
const startTime = meetingDate.toISOString(); // O manualmente con timezone

// Llamar API
const response = await fetch(
  `http://localhost:3004/api/v1/geo/meetings/${establishmentId}/calendly`,
  {
    method: "POST",
    headers: {
      "X-Service-Key": "ventas-easyorder-2024",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      startTime: "2025-12-19T12:00:00-07:00",
      endTime: "2025-12-19T12:30:00-07:00",
      notes: "Cliente interesado en optimizar su restaurante",
    }),
  }
);

const data = await response.json();
console.log(data);
```

## 2. Verificar que el establecimiento tiene email

Antes de intentar crear un meeting con Calendly, verifica que el establecimiento tenga email:

```bash
curl -X GET "http://localhost:3004/api/v1/geo/enrichment/{establishmentId}" \
  -H "X-Service-Key: ventas-easyorder-2024"
```

Respuesta:
```json
{
  "success": true,
  "data": {
    "id": "...",
    "establishmentId": "...",
    "decisionMakerEmail": "cliente@ejemplo.com",  // <- Debe existir
    "decisionMakerName": "Juan Pérez",
    ...
  }
}
```

## 3. Agregar email si no existe

Si el establecimiento no tiene email, agrégalo primero:

```bash
curl -X POST "http://localhost:3004/api/v1/geo/enrichment/{establishmentId}" \
  -H "X-Service-Key: ventas-easyorder-2024" \
  -H "Content-Type: application/json" \
  -d '{
    "decisionMakerEmail": "cliente@ejemplo.com",
    "decisionMakerName": "Juan Pérez"
  }'
```

## 4. Obtener meetings del partner

```bash
curl -X GET "http://localhost:3004/api/v1/geo/meetings/my" \
  -H "X-Service-Key: ventas-easyorder-2024"
```

## 5. Ver meeting específico

```bash
curl -X GET "http://localhost:3004/api/v1/geo/meetings/{establishmentId}" \
  -H "X-Service-Key: ventas-easyorder-2024"
```

Respuesta incluirá el `calendlyEventUri` si fue creado con Calendly:
```json
{
  "success": true,
  "data": {
    "id": "...",
    "establishmentId": "...",
    "meetingScheduled": true,
    "meetingDate": "2025-12-19T19:00:00.000Z",
    "meetingLink": "https://calendly.com/invites/...",
    "calendlyEventUri": "https://api.calendly.com/scheduled_events/...",
    "notes": "..."
  }
}
```

## Errores comunes y soluciones:

### Error: "El establecimiento debe tener un email de contacto registrado"
**Solución:** Agrega el email del tomador de decisiones usando el endpoint de enrichment (ver ejemplo 3)

### Error: "Se requieren startTime y endTime en formato ISO 8601"
**Solución:** Asegúrate de usar el formato correcto con timezone:
```json
{
  "startTime": "2025-12-19T12:00:00-07:00",
  "endTime": "2025-12-19T12:30:00-07:00"
}
```

### Error 401/403: "Solo partners pueden crear meetings"
**Solución:** Verifica que estás usando el header correcto:
- Con JWT: `Authorization: Bearer <token>`
- Con Service Key: `X-Service-Key: ventas-easyorder-2024`

### Error de Calendly API (500)
**Solución:** Revisa los logs del servidor. Posibles causas:
- Token de Calendly expirado o inválido
- Event Type URI incorrecto
- Timezone inválido

## Testing en Postman:

1. **Crear colección** "Calendly Meetings"

2. **Variable de colección:**
   - `baseUrl`: `http://localhost:3004`
   - `serviceKey`: `ventas-easyorder-2024`
   - `establishmentId`: (copiar de un establecimiento con email)

3. **Request "Create Meeting":**
   - Method: `POST`
   - URL: `{{baseUrl}}/api/v1/geo/meetings/{{establishmentId}}/calendly`
   - Headers:
     - `X-Service-Key`: `{{serviceKey}}`
     - `Content-Type`: `application/json`
   - Body (raw JSON):
   ```json
   {
     "startTime": "2025-12-19T12:00:00-07:00",
     "endTime": "2025-12-19T12:30:00-07:00",
     "notes": "Testing Calendly integration"
   }
   ```

4. **Verificar en Calendly:**
   - Inicia sesión en calendly.com
   - Ve a "Scheduled Events"
   - Deberías ver el meeting creado
   - Verifica que se envió el email al cliente
