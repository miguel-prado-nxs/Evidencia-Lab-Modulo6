# Contrato: POST /api/v1/crm-hooks

**Propósito**: Endpoint dedicado para que los Workflows nativos de Twenty CRM disparen acciones en Partners API. Permite la automatización bidireccional: Twenty detecta condición → invoca acción en el sistema de campañas.

**Autenticación**: `x-api-key` header con `API_KEY_SECRET` (middleware `authenticateApiKey`). Solicitudes sin key válida devuelven `401`.

---

## Request

```
POST /api/v1/crm-hooks
Content-Type: application/json
x-api-key: {API_KEY_SECRET}
```

### Body

```json
{
  "action": "string",          // requerido — identifica la acción a ejecutar
  "payload": {                  // requerido — datos específicos de la acción
    "establishmentId": "string" // presente en la mayoría de acciones
    // ...campos adicionales por acción (ver abajo)
  },
  "source": "string",           // opcional — identifica el Workflow de Twenty que dispara (trazabilidad)
  "correlationId": "string"     // opcional — id de correlación para logs
}
```

---

## Acciones soportadas

### `send-whatsapp`

Envía un mensaje de WhatsApp a un establecimiento específico.

```json
{
  "action": "send-whatsapp",
  "payload": {
    "establishmentId": "abc123",
    "templateName": "seguimiento_prospecto",  // nombre del template de mensaje
    "variables": {                             // variables del template (opcional)
      "nombre": "Restaurante El Sol"
    }
  }
}
```

### `requeue-campaign`

Encola el establecimiento en una campaña de llamadas específica.

```json
{
  "action": "requeue-campaign",
  "payload": {
    "establishmentId": "abc123",
    "campaignId": "camp_456",   // requerido
    "reason": "seguimiento_30_dias"  // opcional — para trazabilidad en logs
  }
}
```

---

## Responses

### Éxito — 200

```json
{
  "success": true,
  "action": "send-whatsapp",
  "result": {
    "message": "Acción ejecutada correctamente"
  }
}
```

### Error de validación — 400

```json
{
  "success": false,
  "error": "action es requerido"
}
```

### No autorizado — 401

```json
{
  "success": false,
  "error": "API key inválida o ausente"
}
```

### Acción no soportada — 422

```json
{
  "success": false,
  "error": "Acción no soportada: unknown-action"
}
```

### Error interno — 500

```json
{
  "success": false,
  "error": "Error ejecutando acción"
}
```

---

## Reglas de comportamiento

- El endpoint responde `200` al Workflow de Twenty lo más rápido posible (< 5s) para evitar timeouts en la automatización.
- Las acciones que toman tiempo (requeue-campaign) se ejecutan de forma asíncrona; el `200` confirma la recepción, no la compleción.
- Cada ejecución se loggea con `[CrmHooksController] action={action} source={source} correlationId={correlationId}`.
- Acciones desconocidas devuelven `422` (no `500`) para que el Workflow pueda manejar el caso.

---

## Notas de implementación

- Ruta: `src/routes/crmHooksRoutes.js`
- Controller: `src/controllers/crmHooksController.js`
- Las acciones son un mapa de configuración (pattern del proyecto) — agregar una nueva acción es agregar una entrada al mapa, no modificar el switch.
- Relacionado con: CRM-863, CRM-864

---

## Ejemplos de prueba (PowerShell)

**401 — sin API key:**
```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3004/api/v1/crm-hooks" -ContentType "application/json" -Body '{"action":"send-whatsapp","payload":{"establishmentId":"123"}}'
```
```
Invoke-RestMethod : {"success":false,"error":"API Key requerida"}
```

**400 — falta establishmentId:**
```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3004/api/v1/crm-hooks" -ContentType "application/json" -Headers @{"x-api-key"="<API_KEY>"} -Body '{"action":"send-whatsapp","payload":{}}'
```
```
Invoke-RestMethod : {"success":false,"error":"Required"}
```

**422 — acción desconocida:**
```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3004/api/v1/crm-hooks" -ContentType "application/json" -Headers @{"x-api-key"="<API_KEY>"} -Body '{"action":"accion-inventada","payload":{"establishmentId":"123"}}'
```
```
Invoke-RestMethod : {"success":false,"error":"Accion no soportada: accion-inventada"}
```

**200 — request válido:**
```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3004/api/v1/crm-hooks" -ContentType "application/json" -Headers @{"x-api-key"="<API_KEY>"} -Body '{"action":"send-whatsapp","payload":{"establishmentId":"123"},"source":"twenty-workflow","correlationId":"test-001"}'
```
```
success action        result
------- ------        ------
   True send-whatsapp @{message=Accion ejecutada correctamente}
```
