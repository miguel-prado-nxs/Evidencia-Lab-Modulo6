# Historial de Cambios (Changelog)

Todos los cambios notables en este proyecto serán documentados en este archivo.

## [Unreleased] - 2026-03-11

### Agregado
- **Proxy para Catálogos ElevenLabs**:
  - Creación del nuevo servicio `elevenLabsService.js` en el backend para obtener en tiempo real los catálogos de **Agentes** y **Voces**.
  - Nuevas rutas REST registradas mediante `elevenLabsRoutes.js`.
- **Propagación del Voice Override en A/B Tests**:
  - `abTestsService.js` modificado para agregar param `voiceId` de cada variante hacia la cola en Redis. Encolamiento diferenciado por tipo de agente.
  - Modificación de los workers (`sdrCallWorker.js` y `qualificationCallWorker.js`) para asegurar que el `agent_config_id` y `voice_id` se pasen siempre de forma explícita y transparente.
- **Mejora en Logs**:
  - Implementación de trazas detalladas en los workers de llamadas para depuración de payloads y estados de ruteo.
