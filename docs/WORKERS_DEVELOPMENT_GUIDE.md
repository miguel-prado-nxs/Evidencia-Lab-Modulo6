# Guía de Desarrollo de Workers

Esta guía explica cómo trabajar con el sistema de workers en diferentes entornos.

---

## Desarrollo Local (Sin Agentes Activos)

Si estás desarrollando localmente sin tener los agentes SDR/Qualification activos:

### Comportamiento Esperado

Los jobs se procesarán pero fallarán con error 404:

```
[error]: [SDR Worker] Error en llamada SDR
  "error": "Request failed with status code 404"
  "response": {"message": "Route POST:/api/sdr/initiate-call not found"}
```

Este comportamiento es **ESPERADO** y **NO INDICA UN ERROR** en el sistema de colas.

### Qué Sucede Internamente

1. Worker obtiene el job de la cola
2. Actualiza estado a `CALLED` en BD
3. Intenta llamar al agente (falla con 404)
4. Registra error y actualiza estado a `FAILED`
5. Bull reintenta automáticamente (3 intentos)
6. Después de todos los reintentos, el job se marca como fallido definitivamente

### Advertencias Comunes

**"Job estancado (posible crash)"**
- Es una advertencia de Bull cuando un job tarda más de lo esperado
- Con la configuración actual (5 minutos de timeout), esto debería ser raro
- Bull reintenta automáticamente estos jobs
- En desarrollo sin agentes, es normal ver algunos jobs marcados como estancados

**Soluciones para desarrollo:**

1. **Ignorar los errores 404** - Son esperados sin agentes activos
2. **Usar variables de entorno de prueba** - Configurar URLs que apunten a mocks
3. **Ejecutar agentes localmente** - Levantar los servicios de agentes en tu máquina

---

## Desarrollo con Mock de Agentes

Puedes crear un servidor mock simple para simular respuestas:

**Archivo:** `scripts/mockAgentServer.js`

```javascript
const express = require('express');
const app = express();

app.use(express.json());

// Mock SDR Agent
app.post('/api/sdr/initiate-call', (req, res) => {
  console.log('[Mock SDR] Llamada recibida:', req.body);
  
  // Simular respuesta exitosa
  res.json({
    success: true,
    call_id: `mock-sdr-call-${Date.now()}`,
    status: 'initiated',
    message: 'Llamada SDR simulada exitosamente'
  });
});

// Mock Qualification Agent  
app.post('/api/qualification/initiate-call', (req, res) => {
  console.log('[Mock Qualification] Llamada recibida:', req.body);
  
  // Simular respuesta exitosa
  res.json({
    success: true,
    call_id: `mock-qual-call-${Date.now()}`,
    status: 'initiated',
    message: 'Llamada de calificación simulada exitosamente'
  });
});

const PORT = process.env.MOCK_PORT || 8080;
app.listen(PORT, () => {
  console.log(`Mock Agents corriendo en http://localhost:${PORT}`);
});
```

**Ejecutar:**
```bash
# Terminal 1: Mock de agente SDR
MOCK_PORT=8080 node scripts/mockAgentServer.js

# Terminal 2: Mock de agente Qualification
MOCK_PORT=8081 node scripts/mockAgentServer.js

# Terminal 3: Workers
npm run start:workers

# Terminal 4: Test
npm run test:enqueue
```

**Actualizar .env:**
```env
SDR_AGENT_URL=http://localhost:8080
QUALIFICATION_AGENT_URL=http://localhost:8081
```

---

## Desarrollo con Agentes Reales

Si tienes acceso a los servicios de agentes en desarrollo:

**Railway/Staging:**
```env
SDR_AGENT_URL=https://testing-fabian-ai-voice-agent-prospecto-dev.up.railway.app
SDR_API_KEY=sdr_9888e39e8394a2bce8ae5d317995bbd7ce41adce6560f849

QUALIFICATION_AGENT_URL=https://testing-qualification-agent.up.railway.app
QUALIFICATION_API_KEY=qual_key_placeholder
```

Los workers se conectarán a estos servicios y procesarán llamadas reales.

---

## Producción

En producción, los workers se despliegan como un proceso separado en Railway:

### Configuración

**Servicio:** `partners-api-workers`

**Variables de entorno necesarias:**
- Todas las de `partners-api` (DATABASE_URL, JWT_SECRET, etc.)
- URLs y API Keys de agentes de producción
- Misma configuración de Redis

**Comando de inicio:**
```bash
npm run start:workers
```

### Monitoreo

1. **Railway Logs** - Ver logs en tiempo real del servicio workers
2. **Bull Board** - Acceder en `https://api-url/admin/queues`
3. **Métricas** - Endpoint `/api/ab-tests/queue-stats`

---

## Verificación de Configuración

### 1. Redis Activo
```bash
npm run redis:check
```

Debe responder: `Redis: PONG`

### 2. Workers Iniciados Correctamente
```bash
npm run start:workers
```

Debe mostrar:
```
[info]: === Iniciando Workers de Procesamiento ===
[info]: [SDR Worker] Iniciado con concurrencia de 3 llamadas
[info]: [Qualification Worker] Iniciado con concurrencia de 2 llamadas
[info]: === Todos los workers están activos ===
```

### 3. Encolamiento Funcional
```bash
npm run test:enqueue
```

Debe crear jobs en las colas sin errores de conexión.

### 4. Bull Board Accesible
```bash
npm run dev  # En otra terminal
```

Acceder a: `http://localhost:3004/admin/queues`

Deberías ver las colas "sdr-calls" y "qualification-calls".

---

## Configuración de Bull (Avanzado)

**Archivo:** `src/queues/config.js`

```javascript
settings: {
  // Tiempo máximo de bloqueo antes de marcar como estancado
  lockDuration: 300000, // 5 minutos
  
  // Intervalo de verificación de jobs estancados
  stalledInterval: 30000, // 30 segundos
  
  // Comprobaciones antes de marcar como estancado
  maxStalledCount: 2,
}
```

**Ajustar según necesidad:**
- Llamadas muy largas → Aumentar `lockDuration`
- Muchos falsos positivos de "stalled" → Aumentar `stalledInterval` o `maxStalledCount`
- Workers inestables → Reducir `lockDuration` para recuperar jobs más rápido

---

## Depuración

### Ver logs detallados

Los workers usan Winston para logging estructurado:

**Buscar por job:**
```bash
# En Railway
grep "jobId:sdr-abc-123" logs.txt
```

**Buscar por contacto:**
```bash
grep "abTestContactId:contact-456" logs.txt
```

### Limpiar colas

Si las colas tienen muchos jobs fallidos de pruebas:

**Usando Bull Board:**
1. Ir a `/admin/queues`
2. Seleccionar cola
3. Clic en "Clean" → "Failed jobs"

**Usando Redis CLI:**
```bash
redis-cli
> KEYS bull:sdr-calls:*
> DEL bull:sdr-calls:failed
```

---

## Mejores Prácticas

1. **Desarrollo local:** Usa mocks o ignora errores 404
2. **Testing:** Crea datos de prueba en BD antes de encolar
3. **Logs:** Revisa logs para entender el flujo de procesamiento
4. **Monitoreo:** Usa Bull Board para ver estado de colas
5. **Cleanup:** Limpia jobs de prueba regularmente

---

## Troubleshooting Rápido

| Problema | Causa | Solución |
|----------|-------|----------|
| Jobs no se procesan | Workers no corriendo | `npm run start:workers` |
| Error "Record not found" | Job sin registro en BD | Usar scripts de prueba actualizados |
| Error 404 en `/api/sdr/initiate-call` o `/api/qualification/initiate-call` | Agentes no disponibles o URLs incorrectas | Verificar URLs en .env, usar mocks locales, o ignorar en dev |
| Jobs estancados | Timeout muy bajo | Ajustar `lockDuration` en config |
| Redis desconectado | Redis no activo | `npm run redis:check` y reiniciar Redis |

---

## Recursos

- [Documentación de Workers](WORKERS_PROCESSING.md)
- [Documentación de Queues](QUEUES_SDR_QUALIFICATION.md)
- [Configuración de Redis y Bull](REDIS_BULL_CONFIGURATION.md)
- [Bull Queue Docs](https://github.com/OptimalBits/bull)
