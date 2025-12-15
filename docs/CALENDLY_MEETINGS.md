# Meeting con Calendly - Documentación

## Nuevo Endpoint: Crear Meeting con Calendly

### POST `/api/v1/geo/meetings/:establishmentId/calendly`

Crea un meeting usando la API de Calendly y envía automáticamente una invitación al cliente.

#### Requisitos previos:
- El establecimiento DEBE tener un email registrado en `decisionMakerEmail` del enrichment
- El partner debe estar autenticado

#### Headers:
```
Authorization: Bearer <token_jwt>
# O
X-Service-Key: <service_key>
```

#### Body (JSON):
```json
{
  "startTime": "2025-12-19T12:00:00-07:00",  // ISO 8601 con timezone
  "endTime": "2025-12-19T12:30:00-07:00",    // ISO 8601 con timezone
  "notes": "Quiere ver cómo optimizar su restaurante"  // Opcional
}
```

#### Respuesta exitosa (200):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "establishmentId": "uuid",
    "partnerId": "uuid",
    "meetingScheduled": true,
    "meetingDate": "2025-12-19T19:00:00.000Z",
    "meetingLink": "https://calendly.com/...",
    "calendlyEventUri": "https://api.calendly.com/scheduled_events/...",
    "notes": "...",
    "createdAt": "...",
    "updatedAt": "..."
  },
  "calendly": {
    "resource": {
      "uri": "https://api.calendly.com/scheduled_events/...",
      "booking_url": "https://calendly.com/...",
      ...
    }
  },
  "message": "Meeting creado exitosamente y enviada invitación al cliente"
}
```

#### Errores posibles:

**400 - Email no registrado:**
```json
{
  "success": false,
  "error": "El establecimiento debe tener un email de contacto registrado"
}
```

**400 - Campos faltantes:**
```json
{
  "success": false,
  "error": "Se requieren startTime y endTime en formato ISO 8601"
}
```

**403 - No autorizado:**
```json
{
  "success": false,
  "error": "Solo partners pueden crear meetings"
}
```

## Variables de entorno

Agregar al archivo `.env`:

```env
CALENDLY_API_TOKEN=eyJraWQiOiIxY2UxZTEzNjE3ZGNmNzY2YjNjZWJjY2Y4ZGM1YmFmYThhNjVlNjg0MDIzZjdjMzJiZTgzNDliMjM4MDEzNWI0IiwidHlwIjoiUEFUIiwiYWxnIjoiRVMyNTYifQ.eyJpc3MiOiJodHRwczovL2F1dGguY2FsZW5kbHkuY29tIiwiaWF0IjoxNzY0OTY5MDkyLCJqdGkiOiJiZTZhNGUwZi1iYjk5LTQ1ZTAtODVjYS01NzJmMWMxZGVlNTkiLCJ1c2VyX3V1aWQiOiJjNmIyNTAwMC00ZTYyLTRiYjAtYWU1OS1lY2U4ZDgxZTljOTIifQ.X0RKR9VhbF_sFUgB5Qb1Icok5xJvsmcRlPmBRbJseRSAYdCS0-mWRYjXcVbmw4KMS6nJQNiNuQmy8GfiMUhsYQ
```

## Migración de Base de Datos

Para aplicar la migración que agrega el campo `calendly_event_uri`:

```bash
npx prisma migrate dev --name add_calendly_event_uri
```

O ejecutar manualmente el SQL:
```sql
ALTER TABLE "establishment_meetings" ADD COLUMN "calendly_event_uri" TEXT;
```

## Ejemplo de uso desde el frontend:

```typescript
// En api-client.ts
createMeetingWithCalendly: (
  establishmentId: string,
  startTime: string,  // ISO 8601 format
  endTime: string,
  notes?: string
) => {
  return request<{
    success: boolean;
    data: EstablishmentMeeting;
    calendly: any;
    message: string;
  }>(`/geo/meetings/${establishmentId}/calendly`, {
    method: "POST",
    useServiceKey: true,
    body: JSON.stringify({
      startTime,
      endTime,
      notes,
    }),
  });
}
```

## Flujo de trabajo:

1. Usuario selecciona un establecimiento que tiene email registrado
2. Usuario elige fecha y hora para el meeting
3. Frontend llama al endpoint con startTime/endTime en formato ISO 8601 con timezone
4. Backend verifica que existe email en enrichment
5. Backend llama a Calendly API para crear el meeting
6. **Backend obtiene automáticamente el link de Zoom del evento creado**
7. Calendly envía email automáticamente al cliente
8. Backend guarda el meeting en BD local con link de Zoom
9. Frontend recibe confirmación y muestra el meeting agendado con link de Zoom listo

## Diferencias con el endpoint anterior:

- **Endpoint anterior** (`PATCH /meetings/:establishmentId`): 
  - Manual, solo guarda en BD local
  - No envía invitaciones
  - Más flexible, permite cualquier link
  - Requiere ingresar el link manualmente

- **Endpoint nuevo** (`POST /meetings/:establishmentId/calendly`):
  - Automático, integrado con Calendly
  - Envía invitaciones por email
  - Requiere email registrado
  - Crea meetings con Zoom automático
  - **Obtiene y guarda el link de Zoom automáticamente**
  - No requiere intervención manual
