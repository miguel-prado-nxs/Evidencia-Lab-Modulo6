# Quickstart: Validación E2E — Conciliación de datos campañas → Twenty CRM

**Feature**: 001-crm-mejoras-marketing | **Date**: 2026-06-18

Este documento guía la validación funcional completa (Fase 4 — CRM-853) en staging antes de ir a producción. Cubre los 5 escenarios críticos definidos en el spec.

---

## Prerequisitos

1. Workers corriendo en staging: `npm run start:workers`
2. Twenty CRM staging accesible con los campos custom creados (CRM-855): `ultimaCampana`, `fechaUltimaLlamada`, `totalLlamadasCampana`
3. Al menos un establecimiento con `TwentySyncState` existente (o ninguno, para probar el escenario de creación automática)
4. Acceso a Bull Dashboard: `http://staging-host/admin/queues`
5. Acceso a logs: `railway logs` o equivalente en staging

---

## Escenario 0: Regresión — jobs PIPELINE siguen funcionando tras la migración

**Propósito**: Verificar que la migración T003-T004 no rompe el flujo PIPELINE existente | FR-009

### Pasos

1. Antes de aplicar la migración, anotar el número de jobs en `TwentySyncJob` con `status = DONE`
2. Aplicar la migración `add_interaction_type_to_twenty_sync_job` (T003 → T004)
3. Reiniciar el worker: `npm run start:workers`
4. Encolar un job PIPELINE para un establecimiento conocido (via acción existente o desde Bull Dashboard)
5. Esperar a que el worker lo procese

**Resultado esperado**:
- El job tiene `type = PIPELINE` (default aplicado automáticamente a todos los jobs existentes)
- El worker lo procesa sin errores por el flujo PIPELINE sin cambios
- El `TwentySyncState` del establecimiento se actualiza normalmente

**Verificación SQL**:
```sql
-- Todos los jobs pre-existentes deben tener type = 'PIPELINE'
SELECT type, COUNT(*) FROM twenty_sync_jobs GROUP BY type;
```

**Evidencia**: Al menos un job PIPELINE procesado con status DONE post-migración

---

## Escenario 1: Llamada completada — las 4 etapas

**Propósito**: Verificar FR-001, FR-003, FR-007 | Corresponde a US-1, US-2

### Pasos

Para cada etapa (Discovery, Qualification, Activation, Conversion):

1. Iniciar una llamada de campaña real en staging para el establecimiento de prueba
2. Completar la llamada con el agente (llamada conversacional con outcome COMPLETED)
3. Verificar en Bull Dashboard (`campaign-calls` y `twenty-sync`) que el job INTERACTION apareció en status PENDING → DONE
4. Abrir el Company del establecimiento en Twenty CRM

**Resultado esperado**:
- Aparece una Note con título: `Llamada {Etapa} — Contacto realizado — {fecha}`
- La Note tiene el body completo: campaña, etapa, resultado, duración, resumen, conversationId
- El campo `ultimaCampana` del Company muestra el nombre de la campaña
- El campo `fechaUltimaLlamada` muestra la fecha de la llamada
- El campo `totalLlamadasCampana` se incrementó en 1

**Evidencia**: Captura de pantalla de la Note en Twenty + ID del job en Bull Dashboard

---

## Escenario 2: Llamada fallida (NO_ANSWER / VOICEMAIL)

**Propósito**: Verificar FR-001 (todas las llamadas), GAP-1 del análisis

### Pasos

1. Simular una llamada que no fue contestada (configurar el establecimiento de prueba con número inválido, o forzar el webhook con outcome `NO_ANSWER`)
2. El webhook de ElevenLabs llega a `POST /api/v1/campaigns/elevenlabs-webhook`
3. Verificar que el fallback en `campaignWebhookController` encola el job INTERACTION
4. Abrir el Company en Twenty

**Resultado esperado**:
- Aparece una Note con título: `Llamada {Etapa} — Sin respuesta — {fecha}`
- El body indica que no hubo conversación
- El contador `totalLlamadasCampana` se incrementa (las llamadas sin respuesta también cuentan)

**Resultado NO esperado**:
- Si el agente también llamó `end_*_call` antes del webhook → debe haber solo UNA Note (ver Escenario 3)

---

## Escenario 3: Doble disparo (MCP + webhook) — no duplicación

**Propósito**: Verificar FR-002 — idempotencia por dedupeKey | Crítico de fiabilidad

### Pasos

1. Completar una llamada conversacional (el agente llama `end_discovery_call` vía MCP)
2. Simular que el webhook de ElevenLabs llega después (enviar manualmente el webhook con el mismo `conversation_id`)
3. Verificar logs del `campaignWebhookController`

**Resultado esperado**:
- Solo **una** Note en el Company de Twenty
- En los logs aparece: `[TwentyActivityService] INTERACTION ya encolada, skip { dedupeKey: "interaction:{conversationId}:discovery" }`
- El job INTERACTION del webhook fue silenciado (skipped, no error)

---

## Escenario 4: Retry del webhook — no duplicación

**Propósito**: Verificar FR-002 ante reintentos del sistema externo

### Pasos

1. Completar una llamada
2. Enviar el mismo webhook DOS veces más (simular retry de ElevenLabs)

**Resultado esperado**: Exactamente una Note, los reintentos son silenciados con log `info`

---

## Escenario 5: Establecimiento sin TwentySyncState previo

**Propósito**: Verificar que el sistema crea el Company automáticamente antes de anclar la Note

### Pasos

1. Usar un establecimiento que NO tenga `TwentySyncState` (verificar en BD: `SELECT * FROM twenty_sync_states WHERE establishment_id = 'X'` → sin resultado)
2. Ejecutar una llamada de campaña completada para ese establecimiento
3. Esperar a que el worker procese el job INTERACTION

**Resultado esperado**:
- El worker detecta que no hay `TwentySyncState`, ejecuta el pipeline sync (crea el Company en Twenty)
- Luego crea la Note anclada al Company recién creado
- `TwentySyncState` existe ahora con `twentyEstablecimientoId` poblado
- La Note es visible en el Company

---

## Escenario 6: Backfill histórico (dry-run)

**Propósito**: Verificar FR-006 antes de ejecutar en producción

### Pasos

1. Ejecutar el script en modo dry-run:
   ```bash
   node prisma/scripts/backfill-interactions.js --dry-run
   ```
2. Verificar el output:
   - Total de interacciones históricas encontradas
   - Cuántas ya tienen dedupeKey en TwentySyncJob (serían skip)
   - Cuántas son nuevas

3. Si el dry-run luce correcto, ejecutar:
   ```bash
   node prisma/scripts/backfill-interactions.js
   ```

**Resultado esperado**:
- El script reporta: `Encoladas: X, Saltadas (duplicado): Y, Sin establecimiento mapeable: Z`
- Re-ejecutar el script muestra: `Encoladas: 0, Saltadas: X+Y` (todas ya existían)
- En Bull Dashboard aparecen los jobs INTERACTION procesándose gradualmente

---

## Escenario 7: Campos de campaña en Two CRM

**Propósito**: Verificar FR-007, FR-008 — SC-003

### Verificación manual

1. Abrir la vista de Companies en Twenty CRM
2. Verificar que los campos `ultimaCampana`, `fechaUltimaLlamada` y `totalLlamadasCampana` son visibles en la vista
3. Agregar filtros: `fechaUltimaLlamada < hace 30 días` y verificar que filtra correctamente
4. Hacer click en un Company y verificar que los valores coinciden con los jobs procesados

---

## Queries de diagnóstico (PostgreSQL)

```sql
-- Ver jobs INTERACTION por estado
SELECT type, status, COUNT(*) 
FROM twenty_sync_jobs 
WHERE type = 'INTERACTION'
GROUP BY type, status;

-- Verificar deduplicación: no debe haber dedupeKey repetido
SELECT dedupe_key, COUNT(*) 
FROM twenty_sync_jobs 
WHERE dedupe_key IS NOT NULL
GROUP BY dedupe_key 
HAVING COUNT(*) > 1;

-- Jobs fallidos con error
SELECT id, establishment_id, dedupe_key, status, attempts, last_error
FROM twenty_sync_jobs
WHERE type = 'INTERACTION' AND status = 'FAILED'
ORDER BY updated_at DESC
LIMIT 20;

-- Verificar que TwentySyncState tiene Company mapeado
SELECT establishment_id, twenty_establecimiento_id, last_synced_level
FROM twenty_sync_states
WHERE twenty_establecimiento_id IS NOT NULL
LIMIT 10;
```

---

## Rollback de emergencia

Si el deploy causa problemas:

1. Los jobs INTERACTION en estado PENDING pueden dejarse expirar sin impacto en el flujo principal de campañas
2. Los hooks en `funnelWebhookService.end*Call` son non-blocking — su fallo solo loggea, no interrumpe el MCP
3. Revertir el deploy restaura el comportamiento anterior; los jobs ya creados en BD pueden procesarse manualmente después

**Lo que NO es reversible**: Las Notes ya creadas en Twenty CRM. Si hay Notes incorrectas creadas por un bug, deben borrarse manualmente en la UI de Twenty o vía API.
