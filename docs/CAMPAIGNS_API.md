# API de Campañas - Documentación

## Descripción General

El módulo de Campañas permite crear, gestionar y ejecutar campañas de marketing localizadas con cupones personalizados. Las campañas pueden segmentarse geográficamente y rastrear métricas de conversión.

## Modelos de Datos

### Campaign

```typescript
{
  id: string;
  name: string;
  description?: string;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";
  centerLat?: number;
  centerLng?: number;
  radiusMeters?: number;
  filters?: object;
  totalContacts: number;
  contactsSent: number;
  contactsVisited: number;
  contactsConverted: number;
  createdBy?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

### CampaignContact

```typescript
{
  id: string;
  campaignId: string;
  establishmentId: string;
  establishmentName?: string;
  establishmentPhone?: string;
  establishmentData?: object;
  status: "PENDING" | "SENT" | "DELIVERED" | "VISITED" | "CONVERTED" | "FAILED";
  sentAt?: Date;
  visitedAt?: Date;
  convertedAt?: Date;
  couponId?: string;
  messageId?: string;
  errorReason?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### CampaignCoupon

```typescript
{
  id: string;
  campaignId: string;
  code: string;
  offer: string;
  status: "GENERATED" | "SENT" | "VISITED" | "CONVERTED" | "EXPIRED";
  generatedAt: Date;
  sentAt?: Date;
  visitedAt?: Date;
  convertedAt?: Date;
  visitCount: number;
  lastVisitedAt?: Date;
  conversionData?: object;
  createdAt: Date;
  updatedAt: Date;
}
```

---

## Endpoints de Campañas

### 1. Crear Campaña

**POST** `/api/v1/campaigns`

Crea una nueva campaña en estado DRAFT.

**Headers:**
```
Authorization: Bearer {jwt_token}
Content-Type: application/json
```

**Request Body:**
```json
{
  "name": "Promoción CDMX Centro - Marzo 2026",
  "description": "Campaña de promoción para restaurantes en el centro de CDMX",
  "centerLat": 19.4326,
  "centerLng": -99.1332,
  "radiusMeters": 5000,
  "filters": {
    "city": "CDMX",
    "tags": ["restaurant", "premium"]
  }
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "cm123abc",
    "name": "Promoción CDMX Centro - Marzo 2026",
    "description": "Campaña de promoción para restaurantes en el centro de CDMX",
    "status": "DRAFT",
    "centerLat": 19.4326,
    "centerLng": -99.1332,
    "radiusMeters": 5000,
    "filters": {
      "city": "CDMX",
      "tags": ["restaurant", "premium"]
    },
    "totalContacts": 0,
    "contactsSent": 0,
    "contactsVisited": 0,
    "contactsConverted": 0,
    "createdBy": "user123",
    "createdAt": "2026-03-03T17:00:00.000Z",
    "updatedAt": "2026-03-03T17:00:00.000Z"
  }
}
```

**Errores:**
- `400`: Datos inválidos (nombre faltante, radio negativo, etc.)
- `401`: No autenticado

---

### 2. Listar Campañas

**GET** `/api/v1/campaigns`

Obtiene la lista de campañas del usuario.

**Headers:**
```
Authorization: Bearer {jwt_token}
```

**Query Parameters:**
- `status` (opcional): Filtrar por estado (DRAFT, ACTIVE, PAUSED, COMPLETED, CANCELLED)
- `page` (opcional): Número de página (default: 1)
- `limit` (opcional): Resultados por página (default: 20)

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "cm123abc",
      "name": "Promoción CDMX Centro - Marzo 2026",
      "status": "ACTIVE",
      "totalContacts": 50,
      "contactsSent": 30,
      "contactsVisited": 10,
      "contactsConverted": 5,
      "createdAt": "2026-03-03T17:00:00.000Z",
      "_count": {
        "contacts": 50,
        "coupons": 25
      }
    }
  ],
  "pagination": {
    "total": 10,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

---

### 3. Obtener Campaña por ID

**GET** `/api/v1/campaigns/:id`

Obtiene los detalles completos de una campaña.

**Headers:**
```
Authorization: Bearer {jwt_token}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "cm123abc",
    "name": "Promoción CDMX Centro - Marzo 2026",
    "description": "Campaña de promoción para restaurantes en el centro de CDMX",
    "status": "ACTIVE",
    "centerLat": 19.4326,
    "centerLng": -99.1332,
    "radiusMeters": 5000,
    "totalContacts": 50,
    "contactsSent": 30,
    "contactsVisited": 10,
    "contactsConverted": 5,
    "contacts": [...],
    "coupons": [...]
  }
}
```

**Errores:**
- `404`: Campaña no encontrada
- `403`: Sin permisos para ver esta campaña

---

### 4. Actualizar Campaña

**PATCH** `/api/v1/campaigns/:id`

Actualiza los datos de una campaña.

**Headers:**
```
Authorization: Bearer {jwt_token}
Content-Type: application/json
```

**Request Body:**
```json
{
  "name": "Nuevo nombre de campaña",
  "status": "ACTIVE",
  "description": "Descripción actualizada"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "cm123abc",
    "name": "Nuevo nombre de campaña",
    "status": "ACTIVE",
    "description": "Descripción actualizada",
    ...
  }
}
```

**Errores:**
- `404`: Campaña no encontrada
- `403`: Sin permisos para editar esta campaña
- `400`: No se puede actualizar campaña completada o cancelada

---

### 5. Eliminar Campaña

**DELETE** `/api/v1/campaigns/:id`

Elimina una campaña (solo si no está activa).

**Headers:**
```
Authorization: Bearer {jwt_token}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Campaña eliminada exitosamente"
}
```

**Errores:**
- `404`: Campaña no encontrada
- `403`: Sin permisos
- `400`: No se puede eliminar campaña activa

---

### 6. Asignar Contactos a Campaña

**POST** `/api/v1/campaigns/:id/contacts`

Asigna contactos (establecimientos) a una campaña.

**Headers:**
```
Authorization: Bearer {jwt_token}
Content-Type: application/json
```

**Request Body:**
```json
{
  "establishmentIds": [
    "est-123",
    "est-456",
    "est-789"
  ]
}
```

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "contact-1",
      "campaignId": "cm123abc",
      "establishmentId": "est-123",
      "status": "PENDING",
      "createdAt": "2026-03-03T17:00:00.000Z"
    }
  ],
  "message": "3 contactos asignados exitosamente"
}
```

---

### 7. Asignar Contactos con Filtro Geográfico

**POST** `/api/v1/campaigns/:id/contacts/geo`

Asigna contactos automáticamente basándose en el radio geográfico de la campaña.

**Headers:**
```
Authorization: Bearer {jwt_token}
Content-Type: application/json
```

**Request Body:**
```json
{
  "filters": {
    "minEmployees": 5,
    "tags": ["restaurant"]
  }
}
```

**Response (200):**
```json
{
  "success": true,
  "data": [...],
  "message": "15 contactos asignados exitosamente usando filtro geográfico"
}
```

**Errores:**
- `400`: Campaña debe tener coordenadas y radio definidos

---

### 8. Iniciar Campaña (Batch Calling)

**POST** `/api/v1/campaigns/:id/start`

Inicia una campaña y despacha sus contactos `PENDING` a ElevenLabs Batch Calling.

**Headers:**
```
Authorization: Bearer {jwt_token}
Content-Type: application/json
```

**Request Body (opcional):**
```json
{
  "agentId": "agent_123",
  "targetConcurrencyLimit": 10,
  "maxRecipientsPerRequest": 100,
  "scheduledTimeUnix": 1763330400,
  "agentPhoneNumberId": "phone_abc"
}
```

**Comportamiento:**
- Valida permisos del usuario sobre la campaña.
- Permite iniciar campañas en `DRAFT` o `PAUSED`.
- Bloquea campañas en `ACTIVE`, `COMPLETED` o `CANCELLED`.
- Usa `agentId` del body o fallback a `campaign.agentConfigId`.
- Cambia campaña a `ACTIVE` y setea `startedAt` tras dispatch exitoso.
- Cambia contactos despachados a `CALLING`.
- Contactos inválidos (ej. teléfono inválido) se marcan `FAILED` con `errorReason`.

**Response (200):**
```json
{
  "success": true,
  "message": "Campaña iniciada exitosamente",
  "data": {
    "campaignId": "cm123abc",
    "status": "ACTIVE",
    "startedAt": "2026-03-19T12:00:00.000Z",
    "dispatch": {
      "success": true,
      "totalRecipients": 32,
      "dispatchedRecipients": 30,
      "skippedRecipients": 2,
      "providerBatchIds": ["batch_abc123"]
    }
  }
}
```

**Errores comunes:**
- `400`: campaña sin contactos `PENDING` o sin `agentId` resolvible
- `403`: sin permisos para iniciar la campaña
- `404`: campaña no encontrada
- `409`: campaña ya activa o no iniciable por estado

---

### 9. Obtener Contactos de Campaña

**GET** `/api/v1/campaigns/:id/contacts`

Obtiene la lista de contactos de una campaña.

**Headers:**
```
Authorization: Bearer {jwt_token}
```

**Query Parameters:**
- `status` (opcional): Filtrar por estado
- `page` (opcional): Número de página (default: 1)
- `limit` (opcional): Resultados por página (default: 50)

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "contact-1",
      "campaignId": "cm123abc",
      "establishmentId": "est-123",
      "establishmentName": "Restaurante Test",
      "establishmentPhone": "5255512345",
      "status": "SENT",
      "sentAt": "2026-03-03T17:00:00.000Z",
      "coupon": {
        "code": "PROMO-ABC123",
        "offer": "+2 meses gratis"
      }
    }
  ],
  "pagination": {
    "total": 50,
    "page": 1,
    "limit": 50,
    "totalPages": 1
  }
}
```

---

### 10. Actualizar Estado de Contacto

**PATCH** `/api/v1/campaigns/contacts/:contactId/status`

Actualiza el estado de un contacto en la campaña.

**Headers:**
```
Authorization: Bearer {jwt_token}
Content-Type: application/json
```

**Request Body:**
```json
{
  "status": "SENT",
  "messageId": "whatsapp-msg-123",
  "errorReason": null
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "contact-1",
    "status": "SENT",
    "sentAt": "2026-03-03T17:00:00.000Z",
    "messageId": "whatsapp-msg-123"
  }
}
```

---

### 11. Obtener Estadísticas de Campaña

**GET** `/api/v1/campaigns/:id/stats`

Obtiene métricas y estadísticas detalladas de una campaña.

**Headers:**
```
Authorization: Bearer {jwt_token}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "campaign": {
      "id": "cm123abc",
      "name": "Promoción CDMX Centro - Marzo 2026",
      "status": "ACTIVE"
    },
    "metrics": {
      "totalContacts": 50,
      "contactsSent": 30,
      "contactsVisited": 10,
      "contactsConverted": 5,
      "totalCoupons": 25,
      "conversionRate": "16.67",
      "visitRate": "33.33"
    },
    "statusBreakdown": {
      "PENDING": 20,
      "SENT": 15,
      "VISITED": 10,
      "CONVERTED": 5
    }
  }
}
```

---

## Endpoints de Cupones

### 1. Crear Cupón

**POST** `/api/v1/coupons`

Crea un cupón individual para una campaña.

**Headers:**
```
Authorization: Bearer {jwt_token}
Content-Type: application/json
```

**Request Body:**
```json
{
  "campaignId": "cm123abc",
  "code": "PROMO-CUSTOM-001",
  "offer": "+2 meses gratis en plan Premium"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "coupon-1",
    "campaignId": "cm123abc",
    "code": "PROMO-CUSTOM-001",
    "offer": "+2 meses gratis en plan Premium",
    "status": "GENERATED",
    "visitCount": 0,
    "generatedAt": "2026-03-03T17:00:00.000Z",
    "createdAt": "2026-03-03T17:00:00.000Z"
  }
}
```

---

### 2. Generar Cupones en Lote

**POST** `/api/v1/coupons/bulk`

Genera múltiples cupones automáticamente.

**Headers:**
```
Authorization: Bearer {jwt_token}
Content-Type: application/json
```

**Request Body:**
```json
{
  "campaignId": "cm123abc",
  "count": 50,
  "offerTemplate": "+2 meses gratis en plan Premium"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": [
    {
      "id": "coupon-1",
      "code": "PROMOCIÓ-A1B2C3D4",
      "offer": "+2 meses gratis en plan Premium",
      "status": "GENERATED"
    }
  ],
  "message": "50 cupones generados exitosamente"
}
```

**Errores:**
- `400`: count debe estar entre 1 y 1000

---

### 3. Obtener Cupón por Código

**GET** `/api/v1/coupons/code/:code`

Obtiene un cupón por su código único.

**Headers:**
```
Authorization: Bearer {jwt_token}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "coupon-1",
    "code": "PROMO-ABC123",
    "offer": "+2 meses gratis",
    "status": "VISITED",
    "visitCount": 3,
    "campaign": {
      "id": "cm123abc",
      "name": "Promoción CDMX Centro"
    },
    "contacts": [...]
  }
}
```

---

### 4. Listar Cupones

**GET** `/api/v1/coupons`

Obtiene la lista de cupones.

**Headers:**
```
Authorization: Bearer {jwt_token}
```

**Query Parameters:**
- `campaignId` (opcional): Filtrar por campaña
- `status` (opcional): Filtrar por estado
- `page` (opcional): Número de página
- `limit` (opcional): Resultados por página

**Response (200):**
```json
{
  "success": true,
  "data": [...],
  "pagination": {...}
}
```

---

### 5. Registrar Visita de Cupón (Público)

**POST** `/api/v1/coupons/:code/visit`

Registra cuando un usuario visita un cupón (endpoint público con API Key).

**Headers:**
```
X-API-Key: {api_key}
Content-Type: application/json
```

**Request Body:**
```json
{
  "metadata": {
    "source": "landing_page",
    "userAgent": "Mozilla/5.0..."
  }
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "coupon-1",
    "code": "PROMO-ABC123",
    "status": "VISITED",
    "visitCount": 1,
    "visitedAt": "2026-03-03T17:00:00.000Z"
  },
  "message": "Visita registrada exitosamente"
}
```

---

### 6. Marcar Cupón como Convertido (Público)

**POST** `/api/v1/coupons/:code/convert`

Marca un cupón como convertido cuando el usuario completa la acción deseada.

**Headers:**
```
X-API-Key: {api_key}
Content-Type: application/json
```

**Request Body:**
```json
{
  "conversionData": {
    "dealId": "deal-123",
    "amount": 5000,
    "plan": "premium"
  }
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "coupon-1",
    "code": "PROMO-ABC123",
    "status": "CONVERTED",
    "convertedAt": "2026-03-03T17:00:00.000Z",
    "conversionData": {
      "dealId": "deal-123",
      "amount": 5000,
      "plan": "premium"
    }
  },
  "message": "Cupón marcado como convertido exitosamente"
}
```

---

### 7. Obtener Cupones Disponibles

**GET** `/api/v1/coupons/available`

Obtiene cupones disponibles (no asignados) de una campaña.

**Headers:**
```
Authorization: Bearer {jwt_token}
```

**Query Parameters:**
- `campaignId` (requerido): ID de la campaña

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "coupon-1",
      "code": "PROMO-ABC123",
      "offer": "+2 meses gratis",
      "status": "GENERATED"
    }
  ]
}
```

---

### 8. Asignar Cupón a Contacto

**POST** `/api/v1/coupons/:couponId/assign`

Asigna un cupón específico a un contacto de campaña.

**Headers:**
```
Authorization: Bearer {jwt_token}
Content-Type: application/json
```

**Request Body:**
```json
{
  "contactId": "contact-123"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "contact-123",
    "couponId": "coupon-1",
    ...
  },
  "message": "Cupón asignado al contacto exitosamente"
}
```

---

### 9. Obtener Estadísticas de Cupón

**GET** `/api/v1/coupons/:id/stats`

Obtiene estadísticas detalladas de un cupón.

**Headers:**
```
Authorization: Bearer {jwt_token}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "coupon": {
      "id": "coupon-1",
      "code": "PROMO-ABC123",
      "offer": "+2 meses gratis",
      "status": "CONVERTED"
    },
    "campaign": {
      "id": "cm123abc",
      "name": "Promoción CDMX Centro"
    },
    "metrics": {
      "totalContacts": 1,
      "visitCount": 5,
      "generatedAt": "2026-03-01T00:00:00.000Z",
      "sentAt": "2026-03-02T10:00:00.000Z",
      "visitedAt": "2026-03-02T15:00:00.000Z",
      "convertedAt": "2026-03-03T17:00:00.000Z",
      "lastVisitedAt": "2026-03-03T16:00:00.000Z"
    }
  }
}
```

---

## Flujo de Trabajo Típico

### 1. Crear y Configurar Campaña

```bash
# 1. Crear campaña
POST /api/v1/campaigns
{
  "name": "Promoción Q1 2026",
  "centerLat": 19.4326,
  "centerLng": -99.1332,
  "radiusMeters": 5000
}

# 2. Generar cupones
POST /api/v1/coupons/bulk
{
  "campaignId": "cm123abc",
  "count": 100,
  "offerTemplate": "+2 meses gratis"
}

# 3. Asignar contactos con filtro geográfico
POST /api/v1/campaigns/cm123abc/contacts/geo
{
  "filters": {
    "minEmployees": 5
  }
}

# 4. Activar campaña
PATCH /api/v1/campaigns/cm123abc
{
  "status": "ACTIVE"
}
```

### 2. Monitorear Campaña

```bash
# Ver estadísticas
GET /api/v1/campaigns/cm123abc/stats

# Ver contactos
GET /api/v1/campaigns/cm123abc/contacts?status=SENT

# Ver cupones
GET /api/v1/coupons?campaignId=cm123abc&status=VISITED
```

### 3. Tracking de Conversiones

```bash
# Registrar visita (desde landing page)
POST /api/v1/coupons/PROMO-ABC123/visit
X-API-Key: {api_key}

# Marcar conversión (cuando el usuario se registra)
POST /api/v1/coupons/PROMO-ABC123/convert
X-API-Key: {api_key}
{
  "conversionData": {
    "dealId": "deal-123",
    "plan": "premium"
  }
}
```

---

## Códigos de Error

- `400 Bad Request`: Datos inválidos o faltantes
- `401 Unauthorized`: Token JWT faltante o inválido
- `403 Forbidden`: Sin permisos para realizar la acción
- `404 Not Found`: Recurso no encontrado
- `500 Internal Server Error`: Error del servidor

---

## Notas Importantes

1. **Autenticación**: Todos los endpoints (excepto `/visit` y `/convert`) requieren JWT token
2. **Permisos**: Los usuarios solo pueden ver/editar sus propias campañas (excepto ADMIN)
3. **Estados de Campaña**: Las transiciones de estado deben seguir el flujo lógico
4. **Cupones Únicos**: Los códigos de cupón deben ser únicos en todo el sistema
5. **Límites**: Generación de cupones limitada a 1000 por lote
6. **Geo-Filtrado**: Requiere que la campaña tenga coordenadas y radio definidos

---

## Ejemplos de Integración

Ver `AGENT_INTEGRATION.md` para ejemplos de integración con agentes de WhatsApp y el sistema de colas.
