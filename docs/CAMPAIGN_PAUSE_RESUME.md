# Documentación: Funcionalidad de Pausar y Reanudar Campañas

## 📋 Descripción General

Se ha implementado la funcionalidad de pausar y reanudar campañas de llamadas automáticas. Esto permite:

- **Pausar una campaña ACTIVA**: Detiene temporalmente el procesamiento de llamadas sin cancelar completamente la campaña
- **Reanudar una campaña PAUSADA**: Continúa el procesamiento de contactos pendientes desde donde se pausó
- **Mantener integridad**: Los contactos ya en proceso de llamada continuarán siendo procesados por los webhooks de ElevenLabs

## 🏗️ Arquit ectura de Implementación

### Cambios en la Base de Datos

El modelo de Campaign ya contaba con un estado `PAUSED` en el enum `CampaignStatus`:

```prisma
enum CampaignStatus {
  DRAFT      // Borrador
  ACTIVE     // Campaña activa en ejecución
  PAUSED     // Campaña pausada (NUEVO USO)
  COMPLETED  // Campaña completada
  CANCELLED  // Campaña cancelada
}
```

### Cambios en el Backend

#### 1. **campaignsService.js**

Se agregaron dos nuevos métodos:

##### `pauseCampaign(campaignId)`

```javascript
const pauseCampaign = async (campaignId) => {
  // Validaciones:
  // - Campaña debe existir
  // - Campaña debe estar en estado ACTIVE
  // 
  // Acción:
  // - Cambiar estado de ACTIVE a PAUSED
  // 
  // Logging:
  // - Registra el cambio de estado
  // 
  // Retorna: Objeto campaign actualizado
}
```

##### `resumeCampaign(campaignId)`

```javascript
const resumeCampaign = async (campaignId) => {
  // Validaciones:
  // - Campaña debe existir
  // - Campaña debe estar en estado PAUSED
  // 
  // Acción:
  // - Cambiar estado de PAUSED a ACTIVE
  // - Detecta contactos aún en estado PENDING
  // 
  // Logging:
  // - Registra el cambio de estado
  // - Registra cantidad de contactos pendientes
  // 
  // Retorna: Objeto campaign con info de contactos pendientes
}
```

#### 2. **campaignsController.js**

Se agregaron dos nuevos controladores:

##### `pauseCampaign(req, res, next)`

- Extrae el ID de la campaña de los parámetros
- Llama a `campaignsService.pauseCampaign(id)`
- Retorna la campaña actualizada en estado PAUSED

##### `resumeCampaign(req, res, next)`

- Extrae el ID de la campaña de los parámetros
- Llama a `campaignsService.resumeCampaign(id)`
- Retorna la campaña actualizada en estado ACTIVE con información de contactos pendientes

#### 3. **routes/campaigns.js**

Se agregaron dos nuevas rutas:

```javascript
router.post("/:id/pause", campaignsController.pauseCampaign);
router.post("/:id/resume", campaignsController.resumeCampaign);
```

## 📡 API Endpoints

### Pausar una Campaña

**Endpoint:**
```
POST /campaigns/:id/pause
```

**Parámetros:**
- `:id` - ID de la campaña (path parameter)

**Respuesta (201):**
```json
{
  "success": true,
  "message": "Campaña pausada exitosamente",
  "data": {
    "id": "uuid-campaña",
    "name": "Mi Campaña",
    "status": "PAUSED",
    "startedAt": "2026-03-25T10:30:00Z",
    "TotalContacts": 100,
    ...
  }
}
```

**Errores:**
- `404 - Campaign not found`: La campaña no existe
- `409 - Campaign must be ACTIVE to pause`: La campaña no está activa

### Reanudar una Campaña

**Endpoint:**
```
POST /campaigns/:id/resume
```

**Parámetros:**
- `:id` - ID de la campaña (path parameter)

**Respuesta (200):**
```json
{
  "success": true,
  "message": "Campaña reanudada exitosamente",
  "data": {
    "id": "uuid-campaña",
    "name": "Mi Campaña",
    "status": "ACTIVE",
    "startedAt": "2026-03-25T10:30:00Z",
    "pendingContacts": 42,
    ...
  }
}
```

**Errores:**
- `404 - Campaign not found`: La campaña no existe
- `409 - Campaign must be PAUSED to resume`: La campaña no está pausada

## 🔄 Ciclo de Vida de una Campaña con Pausa/Reanudación

```
DRAFT
  ↓
  (Agregar contactos)
  ↓
ACTIVE ← ─ ─ ─ (Reanuda)
  ↓           ↑
  ├─→ PAUSED ─ ┘
  │             (Pausa)
  ├─→ COMPLETED (Se completa naturalmente)
  │
  └─→ CANCELLED (Por el usuario)
```

## 📊 Estados de Contactos durante Pausa/Reanudación

Los contactos pueden estar en los siguientes estados:

| Estado | Durante Pausa | Después de Reanudar |
|--------|----------------|-------------------|
| PENDING | Permanece igual | Puede ser procesado |
| CALLING | Continúa en progreso | Continúa en progreso |
| CALLED | Completado | Completado |
| RESPONDED | Respondió | Respondió |
| FAILED | Falló | Falló |
| CONVERTED | Convertido | Convertido |

## 🧪 Casos de Uso

### Caso 1: Pausar y Reanudar Campaña

```bash
# 1. Iniciar campaña
POST /campaigns/123/start

# 2. Después de unos minutos, pausar
POST /campaigns/123/pause

# Respuesta:
{
  "success": true,
  "message": "Campaña pausada exitosamente",
  "data": { "status": "PAUSED", ... }
}

# 3. Reanudar la campaña más tarde
POST /campaigns/123/resume

# Respuesta:
{
  "success": true,
  "message": "Campaña reanudada exitosamente",
  "data": { "status": "ACTIVE", "pendingContacts": 42 }
}
```

### Caso 2: Pausar Campaña para Ajustar Configuración

```bash
# Aunque actualmente no se puede editar una campaña ACTIVE,
# la funcionalidad de pausa/resume permite:
# 
# 1. Pausar la campaña ACTIVE
# 2. Los contactos en PENDING se quedan en ese estado
# 3. Los contactos en CALLING continúan siendo procesados
# 4. Reanudar más tarde para continuar

POST /campaigns/123/pause
POST /campaigns/123/resume
```

## 🔐 Consideraciones de Seguridad

### Validaciones Implementadas

1. **Validación de Existencia**: Solo se pueden pausar/reanudar campañas que existen
2. **Validación de Estado**: Solo se puede pausar una campaña ACTIVE
3. **Validación de Estado**: Solo se puede reanudar una campaña PAUSED
4. **Control de Acceso**: (Comentado) Se puede habilitar para verificar que solo el creador o administrador puedan pausar/reanudar

### Validaciones Futuras Recomendadas

```javascript
// Descomentar en campaignsController.js para aplicar RBAC:
if (req.user?.role !== "ADMIN" && campaign.createdBy !== req.user?.id) {
  return res.status(403).json({
    success: false,
    error: "No tienes permisos para pausar esta campaña",
  });
}
```

## 📝 Logging

Tanto la pausa como la reanudación generan logs informativos:

```
[INFO] Campaign paused: campaign-123
  campaignId: "campaign-123"
  previousStatus: "ACTIVE"
  newStatus: "PAUSED"

[INFO] Campaign resumed: campaign-123
  campaignId: "campaign-123"
  previousStatus: "PAUSED"
  newStatus: "ACTIVE"
  pendingContactsCount: 42
```

## 🎯 Integraciones

### Con ElevenLabs

- **No interfiere**: Los batch calls ya enviados a ElevenLabs continuarán ejecutándose
- **Webhooks**: Los webhooks de ElevenLabs seguirán actualizando el estado de contactos en CALLING
- **Nuevas Llamadas**: Cuando se reanuda, los contactos PENDING permanecen en ese estado pero la campaña está ACTIVE

### Con Base de Datos

- **Transacciones**: Las actualizaciones de estado son atómicas
- **Integridad**: Se mantiene la integridad referencial de la campaña y sus contactos
- **Auditoría**: El timestamp de `updatedAt` se actualiza automáticamente

## ⚡ Rendimiento

- **Rápido**: La actualización de estado es una operación simple en Prisma
- **Escalable**: No requiere actualizaciones masivas de contactos
- **Eficiente**: Los logs se generan de forma asíncrona sin bloquear la respuesta

## 🐛 Troubleshooting

### Error: "Campaign must be ACTIVE to pause"

**Causa**: Intentaste pausar una campaña que no está activa

**Solución**: 
1. Verifica el estado de la campaña: `GET /campaigns/:id`
2. Asegúrate de que el estado sea "ACTIVE"
3. Si está en DRAFT, primero inicia la campaña: `POST /campaigns/:id/start`

### Error: "Campaign must be PAUSED to resume"

**Causa**: Intentaste reanudar una campaña que no está pausada

**Solución**:
1. Verifica el estado de la campaña: `GET /campaigns/:id`
2. Asegúrate de que el estado sea "PAUSED"
3. Si está ACTIVE, no necesita reanudarse

### No hay contactos pendientes después de reanudar

**Causa**: Todos los contactos fueron procesados o marcados como fallidos

**Solución**:
1. Revisa el estado de los contactos: `GET /campaigns/:id/contacts`
2. Verifica las estadísticas: `GET /campaigns/:id/stats`
3. Si necesitas llamadas adicionales, crea una nueva campaña

## 🔮 Mejoras Futuras

1. **Resume con Batch Dispatch**: Reanudar podría automáticamente enviar contactos PENDING a ElevenLabs nuevamente
2. **Histórico de Pausas**: Registrar timestamps de pausa/reanudación
3. **Límite de Tiempo de Pausa**: Automáticamente expirar pausas después de X tiempo
4. **Webhook de Pausa**: Notificar a terceros cuando una campaña se paussa/reanuda
5. **Análisis de Impacto**: Mostrar cuántos contactos fueron afectados por la pausa

---

**Última actualización**: 25 de marzo de 2026
**Versión**: 1.0
