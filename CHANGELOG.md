# Historial de Cambios (Changelog)

Todos los cambios notables en este proyecto serán documentados en este archivo.

## [Unreleased] - 2026-03-12

### Agregado
- **Reconciliación de A/B Tests**: Implementación de un proceso de fondo ("reclaimer") en `abTestsService.js` para completar automáticamente contactos que queden estancados en estado `CALLED` por más de 5 minutos.
- **Estabilización de Workflow**: Mejoras generales en la confiabilidad de la ejecución de tests A/B y ruteo de llamadas.

## [1.2.0] - 2026-03-11
