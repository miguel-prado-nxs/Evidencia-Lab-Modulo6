# Historial de Cambios (Changelog)

Todos los cambios notables en este proyecto serán documentados en este archivo.

## [Unreleased] - 2026-03-13

### Agregado
- **Interpolación Inteligente de Voces A/B**: Implementación de lógica en `leadsController.js` para recuperar automáticamente `voice_id` y nombres de agentes desde la base de datos cuando se dispara una llamada manual desde la UI para un contacto perteneciente a un test A/B.

### Cambiado
- **Unificación de Payloads SDR**: Refactorización del flujo de `autoEnrich` para enviar un payload aplanado y estandarizado, eliminando el objeto `agentConfig` anidado que causaba inconsistencias en las voces.
- **Propagación de Nombres**: Mejora en la captura de `prospect_name` desde los datos de enriquecimiento para personalizar el inicio de la conversación del agente.

## [1.2.1] - 2026-03-12

### Agregado
- **Reconciliación de A/B Tests**: Implementación de un proceso de fondo ("reclaimer") en `abTestsService.js` para completar automáticamente contactos que queden estancados en estado `CALLED` por más de 5 minutos.
- **Estabilización de Workflow**: Mejoras generales en la confiabilidad de la ejecución de tests A/B y ruteo de llamadas.

## [1.2.0] - 2026-03-11
