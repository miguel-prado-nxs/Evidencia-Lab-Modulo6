# Resumen de Endpoints API - EasyOrder Partners

**Última actualización:** 30 de marzo de 2026

## Base URL

```
http://localhost:3004/api/v1
```

## Índice

1. [Campañas](#campañas)
2. [Cupones](#cupones)
3. [Templates de Cupones](#templates-de-cupones)
4. [Analytics](#analytics)
5. [Contactos](#contactos)
6. [Partners](#partners)

---

## Campañas

### Gestión de Campañas

| Endpoint | Método | Auth | Descripción |
|----------|--------|------|-------------|
| `/campaigns` | GET | JWT | Lista campañas |
| `/campaigns` | POST | JWT | Crea campaña |
| `/campaigns/:id` | GET | JWT | Obtiene campaña |
| `/campaigns/:id` | PATCH | JWT | Actualiza campaña |
| `/campaigns/:id` | DELETE | JWT | Elimina campaña |

### Operaciones de Campaña

| Endpoint | Método | Auth | Descripción |
|----------|--------|------|-------------|
| `/campaigns/:id/start` | POST | JWT | Inicia campaña (batch calling) |
| `/campaigns/:id/pause` | POST | JWT | Pausa campaña |
| `/campaigns/:id/resume` | POST | JWT | Reanuda campaña |
| `/campaigns/:id/contacts` | GET | JWT | Lista contactos de campaña |
| `/campaigns/:id/contacts` | POST | JWT | Asigna contactos |
| `/campaigns/:id/contacts/geo` | POST | JWT | Asigna contactos con filtro geo |

### Analytics y Validación

| Endpoint | Método | Auth | Descripción |
|----------|--------|------|-------------|
| `/campaigns/:id/stats` | GET | JWT | Estadísticas de campaña |
| `/campaigns/:id/coupon-breakdown` | GET | JWT | **[NUEVO]** Desglose de cupones por tipo |
| `/campaigns/:id/validate-before-start` | GET | JWT | Valida antes de iniciar |
| `/campaigns/:id/send-preview` | GET | JWT | Preview de envío |
| `/campaigns/:id/load-coupon-templates` | POST | JWT | Carga templates de cupones |

### Webhooks

| Endpoint | Método | Auth | Descripción |
|----------|--------|------|-------------|
| `/campaigns/elevenlabs-webhook` | POST | Público | Webhook de ElevenLabs |

---

## Cupones

### Gestión de Cupones

| Endpoint | Método | Auth | Descripción |
|----------|--------|------|-------------|
| `/coupons` | GET | JWT | Lista cupones |
| `/coupons` | POST | JWT | Crea cupón |
| `/coupons/bulk` | POST | JWT | Genera cupones en lote |
| `/coupons/:id` | GET | JWT | Obtiene cupón |
| `/coupons/code/:code` | GET | JWT | Obtiene cupón por código |

### Operaciones de Cupón

| Endpoint | Método | Auth | Descripción |
|----------|--------|------|-------------|
| `/coupons/generate-for-call` | POST | API Key | Genera cupón desde agente |
| `/coupons/:code/visit` | POST | API Key | Registra visita |
| `/coupons/:code/convert` | POST | API Key | Marca como convertido |
| `/coupons/:code/redeem` | POST | API Key | Redime cupón |
| `/coupons/check-eligibility` | POST | API Key | Verifica elegibilidad |
| `/coupons/:couponId/assign` | POST | JWT | Asigna cupón a contacto |

### Analytics de Cupones

| Endpoint | Método | Auth | Descripción |
|----------|--------|------|-------------|
| `/coupons/:id/stats` | GET | JWT | Estadísticas de cupón |
| `/coupons/available` | GET | JWT | Cupones disponibles |

---

## Templates de Cupones

| Endpoint | Método | Auth | Descripción |
|----------|--------|------|-------------|
| `/coupon-templates` | GET | JWT | Lista templates |
| `/coupon-templates/:type` | GET | JWT | Obtiene template por tipo |
| `/coupon-templates` | POST | JWT | Crea template |
| `/coupon-templates/:type` | PATCH | JWT | Actualiza template |
| `/coupon-templates/:type` | DELETE | JWT | Elimina template |

---

## Analytics

### Desglose de Cupones (Nuevo - 2026-03-30)

**Endpoint:** `GET /campaigns/:id/coupon-breakdown`

**Descripción:** Obtiene analytics detallados de distribución de cupones por tipo con métricas de rendimiento. Útil para campañas con múltiples tipos de cupones (híbrido: cupón principal + alternativos).

**Respuesta:**
```json
{
  "success": true,
  "data": {
    "campaignId": "cm123abc",
    "campaignName": "Adquisición Q1 2026",
    "breakdown": [
      {
        "couponType": "TRIAL14",
        "name": "14 días gratis",
        "metrics": {
          "sent": 45,
          "visited": 12,
          "converted": 5,
          "visitRate": "26.67",
          "conversionRate": "11.11"
        }
      }
    ],
    "totals": {
      "sent": 68,
      "visited": 20,
      "converted": 8,
      "visitRate": "29.41",
      "conversionRate": "11.76"
    }
  }
}
```

**Casos de uso:**
- Comparar efectividad de diferentes tipos de cupones
- Identificar qué cupones tienen mejor tasa de conversión
- Analizar rendimiento de cupones alternativos vs principal
- Generar reportes de A/B testing

**Documentación completa:** `docs/COUPON_BREAKDOWN_ANALYTICS.md`

---

## Contactos

| Endpoint | Método | Auth | Descripción |
|----------|--------|------|-------------|
| `/campaigns/contacts/:contactId/status` | PATCH | JWT | Actualiza estado de contacto |

---

## Partners

| Endpoint | Método | Auth | Descripción |
|----------|--------|------|-------------|
| `/partners` | GET | JWT | Lista partners |
| `/partners` | POST | JWT | Crea partner |
| `/partners/:id` | GET | JWT | Obtiene partner |
| `/partners/:id` | PATCH | JWT | Actualiza partner |

---

## Autenticación

### JWT (JSON Web Token)

La mayoría de endpoints requieren autenticación JWT:

```
Authorization: Bearer {jwt_token}
```

### API Key

Algunos endpoints públicos (webhooks, tracking) usan API Key:

```
X-API-Key: {api_key}
```

---

## Códigos de Estado HTTP

| Código | Descripción |
|--------|-------------|
| 200 | OK - Solicitud exitosa |
| 201 | Created - Recurso creado |
| 400 | Bad Request - Datos inválidos |
| 401 | Unauthorized - No autenticado |
| 403 | Forbidden - Sin permisos |
| 404 | Not Found - Recurso no encontrado |
| 500 | Internal Server Error - Error del servidor |

---

## Paginación

Endpoints que retornan listas soportan paginación:

**Query Parameters:**
- `page` (default: 1)
- `limit` (default: 20)

**Respuesta:**
```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "total": 100,
    "page": 1,
    "limit": 20,
    "totalPages": 5
  }
}
```

---

## Testing

### Script de Prueba de Analytics

```bash
node test-coupon-breakdown.js
```

### Postman Collection

Ver: `postman/EasyOrder-Partners-API-Updated.postman_collection.json`

---

## Documentación Adicional

- **Campañas:** `docs/CAMPAIGNS_API.md`
- **Cupones:** `docs/COUPONS_SYSTEM.md`
- **Analytics de Cupones:** `docs/COUPON_BREAKDOWN_ANALYTICS.md`
- **Integración con Agentes:** `docs/AGENT_INTEGRATION.md`
- **Sistema de Colas:** `docs/README_QUEUE_SYSTEM.md`

---

**Versión API:** 1.0  
**Última actualización:** 30 de marzo de 2026
