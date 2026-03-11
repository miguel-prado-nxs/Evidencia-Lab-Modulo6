# Historial de Cambios (Changelog)

Todos los cambios notables en este proyecto serán documentados en este archivo.

## [Unreleased] - 2026-03-11

### Agregado
- **Proxy para Catálogos ElevenLabs**:
  - Creación del nuevo servicio `elevenLabsService.js` en el backend para obtener en tiempo real los catálogos de **Agentes** y **Voces**.
  - Nuevas rutas REST registradas mediante `elevenLabsRoutes.js`.
- **Propagación del Voice Override en A/B Tests**:
  - `abTestsService.js` modificado para agregar param `voiceId` de cada variante hacia la cola en Redis.
  - Modificación de los workers (`sdrCallWorker.js` y `qualificationCallWorker.js`) para extraer y adjuntar `voice_id` en los payloads HTTP que se envían a los respectivos microservicios de Agentes (SDR y Calificación).
