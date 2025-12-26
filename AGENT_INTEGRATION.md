# 🔒 Integración del Agente de Enriquecimiento - Actualización de Seguridad

**Fecha de implementación:** 26 de diciembre de 2025  
**Prioridad:** CRÍTICA  
**Fecha límite de actualización:** Inmediata

---

## 📋 Resumen de Cambios

Se ha implementado un nuevo sistema de autenticación para el endpoint de auto-enriquecimiento para mejorar la seguridad del sistema. **El agente externo debe actualizarse para incluir la nueva API Key en sus requests.**

---

## 🔑 Nueva Autenticación Requerida

### Header Requerido
```
X-Enrichment-Agent-Key: <KEY_PROPORCIONADA_POR_DEVOPS>
```

### Key del Agente
```
a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8
```

**⚠️ IMPORTANTE:** Esta key debe mantenerse segura y NO debe compartirse públicamente.

---

## 🔗 Endpoints Afectados

### 1. Auto-Enrich (Principal)
```
POST https://api.easyorder.mx/api/v1/leads/auto-enrich
```

**Antes (sin seguridad):**
```bash
curl -X POST https://api.easyorder.mx/api/v1/leads/auto-enrich \
  -H "Content-Type: application/json" \
  -d '{
    "businessName": "Restaurante Demo",
    "businessContact": "+525512345678",
    "employeeRange": "11 a 30 personas",
    "establishmentId": "uuid-del-establecimiento"
  }'
```

**Ahora (con seguridad):**
```bash
curl -X POST https://api.easyorder.mx/api/v1/leads/auto-enrich \
  -H "Content-Type: application/json" \
  -H "X-Enrichment-Agent-Key: a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8" \
  -d '{
    "businessName": "Restaurante Demo",
    "businessContact": "+525512345678",
    "employeeRange": "11 a 30 personas",
    "establishmentId": "uuid-del-establecimiento"
  }'
```

---

## 📝 Ejemplos de Implementación

### Python
```python
import requests

ENRICHMENT_AGENT_KEY = "a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8"
API_BASE_URL = "https://api.easyorder.mx/api/v1"

def auto_enrich_lead(data):
    headers = {
        "Content-Type": "application/json",
        "X-Enrichment-Agent-Key": ENRICHMENT_AGENT_KEY
    }
    
    response = requests.post(
        f"{API_BASE_URL}/leads/auto-enrich",
        headers=headers,
        json=data
    )
    
    return response.json()

# Uso
result = auto_enrich_lead({
    "businessName": "Restaurante Demo",
    "businessContact": "+525512345678",
    "employeeRange": "11 a 30 personas",
    "establishmentId": "123e4567-e89b-12d3-a456-426614174000"
})
```

### Node.js
```javascript
const axios = require('axios');

const ENRICHMENT_AGENT_KEY = 'a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8';
const API_BASE_URL = 'https://api.easyorder.mx/api/v1';

async function autoEnrichLead(data) {
  const response = await axios.post(
    `${API_BASE_URL}/leads/auto-enrich`,
    data,
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Enrichment-Agent-Key': ENRICHMENT_AGENT_KEY
      }
    }
  );
  
  return response.data;
}

// Uso
autoEnrichLead({
  businessName: 'Restaurante Demo',
  businessContact: '+525512345678',
  employeeRange: '11 a 30 personas',
  establishmentId: '123e4567-e89b-12d3-a456-426614174000'
})
.then(result => console.log(result))
.catch(error => console.error(error));
```

---

## ⚠️ Códigos de Error

### 401 Unauthorized
```json
{
  "success": false,
  "error": "X-Enrichment-Agent-Key header requerido"
}
```
**Causa:** El header no está presente en el request.

### 403 Forbidden
```json
{
  "success": false,
  "error": "X-Enrichment-Agent-Key inválida"
}
```
**Causa:** La key proporcionada no coincide con la key configurada en el servidor.

### 500 Internal Server Error
```json
{
  "success": false,
  "error": "Configuración del servidor incompleta"
}
```
**Causa:** Error de configuración del servidor (contactar a DevOps).

---

## 📊 Rate Limiting

- **Límite:** 100 requests por minuto por IP
- **Ventana:** 60 segundos
- **Headers de respuesta:**
  - `X-RateLimit-Limit`: Límite total
  - `X-RateLimit-Remaining`: Requests restantes
  - `X-RateLimit-Reset`: Timestamp cuando se resetea

Si se excede el límite:
```json
{
  "success": false,
  "error": "TOO_MANY_REQUESTS",
  "message": "Demasiadas solicitudes desde esta IP"
}
```

---

## ✅ Validación de Campos

Todos los campos deben cumplir con las siguientes validaciones:

```javascript
{
  businessName: string (min 1 char),
  businessContact: string (opcional),
  employeeRange: string (opcional),
  establishmentId: UUID v4 (requerido)
}
```

---

## 🔍 Testing

### 1. Verificar conectividad
```bash
curl -X POST https://api.easyorder.mx/api/v1/leads/auto-enrich \
  -H "Content-Type: application/json" \
  -H "X-Enrichment-Agent-Key: a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8" \
  -d '{"test": true}'
```

### 2. Verificar autenticación
Sin key (debe fallar con 401):
```bash
curl -X POST https://api.easyorder.mx/api/v1/leads/auto-enrich \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

Con key incorrecta (debe fallar con 403):
```bash
curl -X POST https://api.easyorder.mx/api/v1/leads/auto-enrich \
  -H "Content-Type: application/json" \
  -H "X-Enrichment-Agent-Key: invalid-key" \
  -d '{"test": true}'
```

---

## 📞 Soporte

Si tienes problemas con la integración:

1. **Verificar key:** Asegúrate de usar la key correcta
2. **Verificar headers:** El header debe ser exactamente `X-Enrichment-Agent-Key`
3. **Verificar logs:** Revisar los logs del agente para ver errores específicos
4. **Contactar DevOps:** Si el problema persiste

---

## 📅 Timeline de Implementación

- ✅ **26 Dic 2025 - 10:00:** Implementación en servidor
- ⏰ **26 Dic 2025 - EOD:** Actualización del agente requerida
- 🔄 **27 Dic 2025 - AM:** Verificación conjunta de funcionamiento

---

## 🔐 Mejores Prácticas

1. **NO hardcodear la key en el código fuente**
   - Usar variables de entorno
   - Usar gestores de secretos (AWS Secrets Manager, etc.)

2. **Loggear solo metadata, nunca la key completa**
   ```javascript
   console.log('Using agent key:', key.substring(0, 8) + '...');
   ```

3. **Implementar retry logic con backoff exponencial**
   ```javascript
   async function retryWithBackoff(fn, maxRetries = 3) {
     for (let i = 0; i < maxRetries; i++) {
       try {
         return await fn();
       } catch (error) {
         if (i === maxRetries - 1) throw error;
         await sleep(Math.pow(2, i) * 1000);
       }
     }
   }
   ```

4. **Monitorear errores 401/403**
   - Alertar si hay múltiples fallos de autenticación
   - Puede indicar key comprometida o configuración incorrecta
