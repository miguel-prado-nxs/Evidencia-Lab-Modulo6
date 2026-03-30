# Historial de Cambios (Changelog)

Todos los cambios notables en este proyecto serán documentados en este archivo.

## [Unreleased] - 2026-03-30

### Agregado
- **Analytics de Cupones por Tipo**:
  - Nuevo endpoint `GET /api/v1/campaigns/:id/coupon-breakdown` para obtener desglose detallado de cupones por tipo.
  - Métricas incluidas: enviados, visitados, convertidos, tasas de conversión y visitas totales.
  - Soporte para análisis de campañas con múltiples tipos de cupones (híbrido: principal + alternativos).
  - Documentación completa en `docs/COUPON_BREAKDOWN_ANALYTICS.md`.
  - Script de prueba: `test-coupon-breakdown.js`.

## [Unreleased] - 2026-03-20

### Agregado
- **Interpolación Inteligente de Voces A/B**: 
  - Implementación de lógica en `leadsController.js` para recuperar automáticamente `voice_id` y nombres de agentes desde la base de datos.
  - Soporte para llamadas manuales desde UI que respetan configuración de tests A/B activos.
  - Recuperación automática de variantes asignadas por contacto.
- **Endpoint de Auto-Calificación**:
  - Nuevo endpoint `/leads/auto-qualify` para iniciar proceso de calificación automática.
  - Validación de datos de tomador de decisiones (nombre, teléfono, email, posición).
  - Integración con servicios de calificación de ElevenLabs.

### Cambiado
- **Unificación de Payloads SDR**: 
  - Refactorización del flujo de `autoEnrich` para enviar un payload aplanado y estandarizado.
  - Eliminación del objeto `agentConfig` anidado que causaba inconsistencias en las voces.
  - Estructura de datos simplificada para mejor compatibilidad con agentes de ElevenLabs.
- **Propagación de Nombres**: 
  - Mejora en la captura de `prospect_name` desde los datos de enriquecimiento.
  - Personalización del inicio de la conversación del agente con nombre del prospecto.
  - Soporte para `dynamic_variables` en llamadas salientes.

## [1.2.1] - 2026-03-12

### Agregado
- **Reconciliación de A/B Tests**: Implementación de un proceso de fondo ("reclaimer") en `abTestsService.js` para completar automáticamente contactos que queden estancados en estado `CALLED` por más de 5 minutos.
- **Estabilización de Workflow**: Mejoras generales en la confiabilidad de la ejecución de tests A/B y ruteo de llamadas.

## [1.2.0] - 2026-03-11
