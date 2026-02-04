# Changelog - EasyOrder Partners API

## [2026-02-04] - Optimización de SDR Interactions

### Cambios
- **sdrController.js**: Cuando el tomador de decisiones es identificado (`enrichmentStatus === "identified"`):
  - NO se crea registro en `sdr_interactions`
  - Se eliminan los registros previos de `sdr_interactions` para ese establecimiento
  - Los datos quedan conservados únicamente en `establishment_enrichments`

- **sdrInteractionsService.js**: Nueva función `deleteByEstablishment(establishmentId)`:
  - Elimina todos los registros de interacciones SDR para un establecimiento específico
  - Retorna el número de registros eliminados
  - Exportada en el module.exports

### Motivo
Evitar duplicación de datos cuando el tomador de decisiones ya fue identificado. Los datos del decision maker quedan guardados solo en `establishment_enrichments`, eliminando registros intermedios innecesarios en `sdr_interactions`.

### Flujo resultante
1. Llamadas sin identificar al tomador de decisiones → se guarda en `sdr_interactions` (para métricas/reintentos)
2. Cuando se identifica al DM → se eliminan las interacciones previas y solo se conservan los datos en `establishment_enrichments`
