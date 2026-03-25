# Changelog - Funcionalidad de Pausar y Reanudar Campañas

## [v1.0.0] - 2026-03-25

### ✨ Nuevas Características

#### Pausar Campañas
- **Endpoint**: `POST /campaigns/:id/pause`
- **Descripción**: Permite pausar una campaña activa sin cancelarla completamente
- **Estados Permitidos**: Solo campañas en estado `ACTIVE` pueden ser pausadas
- **Resultado**: Campaña cambia a estado `PAUSED`
- **Impacto en Contactos**:
  - Contactos en `PENDING`: Se mantienen en ese estado (esperando al resume)
  - Contactos en `CALLING`: Continúan siendo procesados por webhooks de ElevenLabs
  - Contactos en estados finales: No son afectados

#### Reanudar Campañas
- **Endpoint**: `POST /campaigns/:id/resume`
- **Descripción**: Reanuda una campaña pausada para continuar procesando contactos
- **Estados Permitidos**: Solo campañas en estado `PAUSED` pueden ser reanudadas
- **Resultado**: Campaña cambia a estado `ACTIVE`
- **Información**: Retorna cantidad de contactos aún en estado `PENDING`

### 📝 Cambios Técnicos

#### Backend (`src/services/campaignsService.js`)
```javascript
// Nuevos métodos exportados:
- pauseCampaign(campaignId): Pausar campaña
- resumeCampaign(campaignId): Reanudar campaña
```

#### Controladores (`src/controllers/campaignsController.js`)
```javascript
// Nuevas funciones exportadas:
- pauseCampaign(req, res, next): Handler para pausar
- resumeCampaign(req, res, next): Handler para reanudar
```

#### Rutas (`src/routes/campaigns.js`)
```javascript
// Nuevas rutas definidas:
POST /:id/pause   → campaignsController.pauseCampaign
POST /:id/resume  → campaignsController.resumeCampaign
```

### 📊 Estructura de Respuestas

#### Pausar - Éxito (200)
```json
{
  "success": true,
  "message": "Campaña pausada exitosamente",
  "data": {
    "id": "uuid",
    "name": "Nombre Campaña",
    "status": "PAUSED",
    "totalContacts": 100,
    "totalCalled": 45,
    "startedAt": "2026-03-25T10:00:00Z",
    "updatedAt": "2026-03-25T14:30:00Z"
  }
}
```

#### Reanudar - Éxito (200)
```json
{
  "success": true,
  "message": "Campaña reanudada exitosamente",
  "data": {
    "id": "uuid",
    "name": "Nombre Campaña",
    "status": "ACTIVE",
    "pendingContacts": 55,
    "totalContacts": 100,
    "startedAt": "2026-03-25T10:00:00Z",
    "updatedAt": "2026-03-25T14:35:00Z"
  }
}
```

#### Errores
```json
{
  "success": false,
  "error": "Campaign must be ACTIVE to pause. Current status: PAUSED"
}
// Con HTTP Status: 409 Conflict
```

### 🔒 Validaciones Implementadas

1. ✅ **Existencia de Campaña**: Validar que la campaña existe
2. ✅ **Estado Válido para Pausa**: Solo `ACTIVE` → `PAUSED`
3. ✅ **Estado Válido para Reanudación**: Solo `PAUSED` → `ACTIVE`
4. ✅ **Logging**: Registra cambios de estado
5. ⚠️ **Control de Acceso**: Comentado (puede habilitarse con RBAC)

### 📚 Documentación Creada

1. **CAMPAIGN_PAUSE_RESUME.md** - Documentación técnica completa
2. **examples-pause-resume.sh** - Scripts bash con ejemplos
3. **examples-pause-resume.js** - Ejemplos en múltiples lenguajes

### 🧪 Casos de Uso

1. **Pausar por Mantenimiento**
   - Pausar campaña
   - Realizar ajustes
   - Reanudar para continuar

2. **Control de Ritmo**
   - Pausar si el sistema se sobrecarga
   - Reanudar cuando se normaliza

3. **Interrupciones**
   - Pausar si hay issue crítico
   - Reanudar una vez resuelto

4. **Análisis**
   - Pausar para analizar resultados parciales
   - Reanudar según insights

### 🔄 Ciclo de Vida

```
DRAFT
  ↓
ACTIVE ←─────── (resume)
  ↓          ↑
  ├→ PAUSED ─┘ (pause)
  │
  ├→ COMPLETED
  │
  └→ CANCELLED
```

### ⚙️ Impacto de Cambios

| Componente | Cambio | Impacto |
|-----------|--------|--------|
| DB Schema | Nada (PAUSED ya existía) | ✅ Ninguno |
| Migrations | No requeridas | ✅ Ninguno |
| APIs Externas | Nada | ✅ Ninguno |
| Webhooks | Nada | ✅ Ninguno |
| Performance | Operación: O(1) | ✅ Sin impacto |

### 🚀 Próximas Mejoras (Backlog)

1. [ ] Auto-dispatch de contactos pendientes en reanudación
2. [ ] Webhook notifications en pausa/reanudación
3. [ ] API endpoint para histórico de pausas
4. [ ] Automatic pause si hay errores sostenidos
5. [ ] UI Controls en el frontend
6. [ ] Análisis de impacto de pausas

### 🔧 Instalación / Rollout

1. ✅ Merge en rama development
2. ✅ Test en environment staging
3. 🚀 Deploy a production
4. 📊 Monitorear logs para "Campaign paused" / "Campaign resumed"

### 🐛 Known Issues

Ninguno reportado

### 💬 Feedback & Soporte

Para preguntas o issues:
- Revisar [CAMPAIGN_PAUSE_RESUME.md](./CAMPAIGN_PAUSE_RESUME.md)
- Ver ejemplos en [examples-pause-resume.sh](./examples-pause-resume.sh)
- Contactar al equipo de desarrollo

---

**Autores**: Equipo de Desarrollo
**Fecha**: 2026-03-25
**Versión**: 1.0.0
**Estado**: ✅ Completado y Documentado
