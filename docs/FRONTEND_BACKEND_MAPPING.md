# 🔄 Mapeo Frontend-Backend: Módulo de Campañas

Este documento detalla el mapeo entre los campos y estados del frontend (`web-easyorder-ventas`) y el backend (`easyorder-partners-api`).

## 📊 Estados de Campaña

| Frontend | Backend | Notas |
|----------|---------|-------|
| `"Pending"` | `"DRAFT"` | Campaña en borrador, no iniciada |
| `"Running"` | `"ACTIVE"` | Campaña activa y ejecutándose |
| `"Paused"` | `"PAUSED"` | Campaña pausada temporalmente |
| `"Completed"` | `"COMPLETED"` | Campaña finalizada |
| N/A | `"CANCELLED"` | Campaña cancelada (no usado en frontend aún) |

### Conversión en Frontend
```typescript
function mapBackendStatusToFrontend(backendStatus: string): string {
  const mapping = {
    'DRAFT': 'Pending',
    'ACTIVE': 'Running',
    'PAUSED': 'Paused',
    'COMPLETED': 'Completed',
    'CANCELLED': 'Cancelled'
  };
  return mapping[backendStatus] || backendStatus;
}
```

## 👥 Estados de Contacto

| Frontend | Backend | Descripción |
|----------|---------|-------------|
| `"Pending"` | `"PENDING"` | Contacto pendiente de llamar |
| `"Calling"` | `"CALLING"` | Llamada en progreso |
| `"Called"` | `"CALLED"` | Llamada realizada |
| `"Responded"` | `"RESPONDED"` | Contacto respondió positivamente |
| N/A | `"SENT"` | Mensaje/cupón enviado |
| N/A | `"DELIVERED"` | Mensaje entregado (WhatsApp) |
| N/A | `"VISITED"` | Visitó landing de cupón |
| `"Converted"` | `"CONVERTED"` | Se convirtió en cliente |
| `"Failed"` | `"FAILED"` | Falló el contacto |

### Conversión en Frontend
```typescript
function mapBackendContactStatusToFrontend(backendStatus: string): string {
  const mapping = {
    'PENDING': 'Pending',
    'CALLING': 'Calling',
    'CALLED': 'Called',
    'RESPONDED': 'Responded',
    'SENT': 'Called', // Mapear a "Called" para simplificar
    'DELIVERED': 'Called',
    'VISITED': 'Responded',
    'CONVERTED': 'Converted',
    'FAILED': 'Failed'
  };
  return mapping[backendStatus] || backendStatus;
}
```

## 🗺️ Campos de Campaña

### Campos Básicos

| Frontend | Backend | Tipo | Notas |
|----------|---------|------|-------|
| `name` | `name` | `string` | ✅ Match |
| `description` | `description` | `string` | ✅ Match |
| `type` | `type` | `enum` | ✅ Match: `"Acquisition"` → `"ACQUISITION"` |
| `status` | `status` | `enum` | ⚠️ Ver mapeo arriba |

### Segmentación Geográfica

| Frontend | Backend | Tipo | Conversión |
|----------|---------|------|------------|
| `radiusKm` | `radiusMeters` | `number` | `radiusKm * 1000 = radiusMeters` |
| `centerLat` | `centerLat` | `number` | ✅ Match |
| `centerLng` | `centerLng` | `number` | ✅ Match |

**Ejemplo de conversión:**
```typescript
// Frontend → Backend
const radiusMeters = radiusKm * 1000;

// Backend → Frontend
const radiusKm = radiusMeters / 1000;
```

### Filtros de Audiencia

| Frontend | Backend | Tipo | Notas |
|----------|---------|------|-------|
| `activityCodes` | `activityCodes` | `string[]` | ✅ Match - Códigos SCIAN |
| `employeeRanges` | `employeeRanges` | `string[]` | ✅ Match - Ej: `["1-5", "6-10"]` |
| `twentyFilters` | `filters` | `JSON` | ⚠️ Guardar en campo `filters` |

### Agente y Oferta

| Frontend | Backend | Tipo | Notas |
|----------|---------|------|-------|
| `agentConfigId` | `agentConfigId` | `string` | ✅ Match |
| N/A | `agentConfigName` | `string` | Solo backend (para display) |
| `offer` | `offer` | `string` | ✅ Match |
| `couponPrefix` | `couponPrefix` | `string` | ✅ Match |

### Métricas

| Frontend | Backend | Tipo | Notas |
|----------|---------|------|-------|
| `sent` | `totalCalled` | `number` | ⚠️ Mapear `totalCalled` → `sent` |
| `delivered` | `totalResponded` | `number` | ⚠️ Mapear `totalResponded` → `delivered` |
| `opened` | `couponsVisited` | `number` | ⚠️ Mapear `couponsVisited` → `opened` |
| `clicked` | `couponsConverted` | `number` | ⚠️ Mapear `couponsConverted` → `clicked` |
| N/A | `totalContacts` | `number` | Total de contactos asignados |
| N/A | `totalConverted` | `number` | Total de conversiones |
| N/A | `totalFailed` | `number` | Total de fallos |
| N/A | `couponsSent` | `number` | Total de cupones enviados |

**Ejemplo de mapeo de métricas:**
```typescript
interface FrontendMetrics {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
}

function mapBackendMetricsToFrontend(campaign: BackendCampaign): FrontendMetrics {
  return {
    sent: campaign.totalCalled,
    delivered: campaign.totalResponded,
    opened: campaign.couponsVisited,
    clicked: campaign.couponsConverted
  };
}
```

## 🔌 Endpoints API

### Crear Campaña

**Frontend Request:**
```typescript
POST /api/v1/campaigns
{
  "name": "Campaña Test",
  "description": "Descripción",
  "type": "Acquisition",
  "centerLat": 19.4326,
  "centerLng": -99.1332,
  "radiusKm": 5,
  "activityCodes": ["722511", "722512"],
  "employeeRanges": ["6-10", "11-30"],
  "agentConfigId": "agent-001",
  "offer": "20% descuento",
  "couponPrefix": "TEST2024"
}
```

**Backend Request (conversión necesaria):**
```typescript
POST /api/v1/campaigns
{
  "name": "Campaña Test",
  "description": "Descripción",
  "type": "ACQUISITION",  // Uppercase
  "centerLat": 19.4326,
  "centerLng": -99.1332,
  "radiusMeters": 5000,  // radiusKm * 1000
  "activityCodes": ["722511", "722512"],
  "employeeRanges": ["6-10", "11-30"],
  "agentConfigId": "agent-001",
  "offer": "20% descuento",
  "couponPrefix": "TEST2024"
}
```

### Obtener Campaña

**Backend Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Campaña Test",
    "status": "ACTIVE",
    "type": "ACQUISITION",
    "radiusMeters": 5000,
    "activityCodes": ["722511"],
    "totalCalled": 10,
    "totalResponded": 5,
    "couponsVisited": 3,
    "couponsConverted": 1
  }
}
```

**Frontend (después de mapeo):**
```typescript
{
  id: "uuid",
  name: "Campaña Test",
  status: "Running",  // Mapeado de "ACTIVE"
  type: "Acquisition",  // Mapeado de "ACQUISITION"
  radiusKm: 5,  // Convertido de 5000 metros
  activityCodes: ["722511"],
  metrics: {
    sent: 10,  // totalCalled
    delivered: 5,  // totalResponded
    opened: 3,  // couponsVisited
    clicked: 1  // couponsConverted
  }
}
```

## 📝 Tipos TypeScript para Frontend

```typescript
// types/campaigns.ts

export type CampaignStatus = 'Pending' | 'Running' | 'Paused' | 'Completed';
export type CampaignType = 'Acquisition' | 'Nurturing' | 'Reactivation';
export type ContactStatus = 'Pending' | 'Calling' | 'Called' | 'Responded' | 'Converted' | 'Failed';

export interface Campaign {
  id: string;
  name: string;
  description?: string;
  status: CampaignStatus;
  type: CampaignType;
  
  // Geografía
  centerLat?: number;
  centerLng?: number;
  radiusKm?: number;
  
  // Filtros
  activityCodes?: string[];
  employeeRanges?: string[];
  
  // Agente y oferta
  agentConfigId?: string;
  offer?: string;
  couponPrefix?: string;
  
  // Métricas
  metrics: {
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
  };
  
  // Metadata
  createdAt: string;
  updatedAt: string;
}

export interface Contact {
  id: string;
  campaignId: string;
  name: string;
  phone: string;
  status: ContactStatus;
  lastContact?: string;
  couponCode?: string;
  couponVisited?: boolean;
}
```

## 🔧 Funciones Utilitarias Recomendadas

```typescript
// utils/campaignMapper.ts

export const CampaignMapper = {
  // Status
  toBackendStatus(frontendStatus: string): string {
    const mapping: Record<string, string> = {
      'Pending': 'DRAFT',
      'Running': 'ACTIVE',
      'Paused': 'PAUSED',
      'Completed': 'COMPLETED'
    };
    return mapping[frontendStatus] || frontendStatus;
  },
  
  toFrontendStatus(backendStatus: string): string {
    const mapping: Record<string, string> = {
      'DRAFT': 'Pending',
      'ACTIVE': 'Running',
      'PAUSED': 'Paused',
      'COMPLETED': 'Completed',
      'CANCELLED': 'Cancelled'
    };
    return mapping[backendStatus] || backendStatus;
  },
  
  // Type
  toBackendType(frontendType: string): string {
    return frontendType.toUpperCase();
  },
  
  toFrontendType(backendType: string): string {
    return backendType.charAt(0) + backendType.slice(1).toLowerCase();
  },
  
  // Radius
  toBackendRadius(radiusKm: number): number {
    return Math.round(radiusKm * 1000);
  },
  
  toFrontendRadius(radiusMeters: number): number {
    return radiusMeters / 1000;
  },
  
  // Metrics
  toFrontendMetrics(campaign: any) {
    return {
      sent: campaign.totalCalled || 0,
      delivered: campaign.totalResponded || 0,
      opened: campaign.couponsVisited || 0,
      clicked: campaign.couponsConverted || 0
    };
  },
  
  // Full campaign mapping
  toFrontend(backendCampaign: any): Campaign {
    return {
      id: backendCampaign.id,
      name: backendCampaign.name,
      description: backendCampaign.description,
      status: this.toFrontendStatus(backendCampaign.status),
      type: this.toFrontendType(backendCampaign.type),
      centerLat: backendCampaign.centerLat,
      centerLng: backendCampaign.centerLng,
      radiusKm: backendCampaign.radiusMeters ? this.toFrontendRadius(backendCampaign.radiusMeters) : undefined,
      activityCodes: backendCampaign.activityCodes,
      employeeRanges: backendCampaign.employeeRanges,
      agentConfigId: backendCampaign.agentConfigId,
      offer: backendCampaign.offer,
      couponPrefix: backendCampaign.couponPrefix,
      metrics: this.toFrontendMetrics(backendCampaign),
      createdAt: backendCampaign.createdAt,
      updatedAt: backendCampaign.updatedAt
    };
  },
  
  toBackend(frontendCampaign: any) {
    return {
      name: frontendCampaign.name,
      description: frontendCampaign.description,
      type: this.toBackendType(frontendCampaign.type),
      centerLat: frontendCampaign.centerLat,
      centerLng: frontendCampaign.centerLng,
      radiusMeters: frontendCampaign.radiusKm ? this.toBackendRadius(frontendCampaign.radiusKm) : undefined,
      activityCodes: frontendCampaign.activityCodes,
      employeeRanges: frontendCampaign.employeeRanges,
      agentConfigId: frontendCampaign.agentConfigId,
      offer: frontendCampaign.offer,
      couponPrefix: frontendCampaign.couponPrefix
    };
  }
};
```

## ✅ Checklist de Integración

- [ ] Implementar funciones de mapeo en frontend
- [ ] Actualizar tipos TypeScript
- [ ] Reemplazar localStorage con llamadas a API
- [ ] Convertir `radiusKm` ↔ `radiusMeters`
- [ ] Mapear estados de campaña
- [ ] Mapear estados de contacto
- [ ] Mapear métricas correctamente
- [ ] Manejar errores de API
- [ ] Agregar loading states
- [ ] Probar flujo completo: crear → listar → editar → eliminar

## 📞 Contacto

Para dudas sobre la integración, contactar al equipo de backend o revisar la documentación completa en `docs/CAMPAIGNS_API.md`.
