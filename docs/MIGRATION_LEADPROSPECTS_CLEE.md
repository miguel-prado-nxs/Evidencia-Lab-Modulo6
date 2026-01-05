# Migración de lead_prospects a usar CLEE

## Problema
Las tablas `establishment_enrichments` y `lead_prospects` usaban diferentes identificadores para el mismo concepto (establecimiento):
- `establishment_enrichments.establishment_id` → **clee** (DENUE)
- `lead_prospects.establishment_id` → **UUID** (Establishment.id)

Esta inconsistencia causaba:
1. Imposibilidad de relacionar datos entre tablas
2. Errores en "Pasar a Lead" al buscar establishments por UUID
3. Problemas potenciales en "Calificar Automático"

## Solución Implementada

### 1. Cambios en Código

#### `src/services/ventasEnrichmentService.js`
- **Línea 188-211**: Actualizado `convertContactToProspect` para usar `clee` en lugar de `establishment.id` al crear/buscar `leadProspect`
- Comentario actualizado: "leadProspect usa el clee (igual que establishment_enrichments)"
- Agregadas notas automáticas al crear/actualizar prospectos

#### `src/services/geoService.js`
- **Línea 384-393**: `convertProspectToLead` ahora busca establishment por clee usando `findFirst`
- **Línea 444-467**: `getPartnerProspects` ahora busca establishments por clee en batch
- Agregados logs detallados para rastrear el proceso de conversión
- Agregadas notas automáticas al convertir prospecto a lead

#### `src/services/enrichmentService.js`
- **Línea 300-350**: Agregada lógica automática para crear lead cuando el nivel cambia a LEAD
- Convierte prospecto automáticamente si existe
- Crea lead directamente si no hay prospecto previo

#### `src/controllers/sdrController.js`
- **Línea 203**: Agregado comentario "establishmentId debe ser el clee"

#### `prisma/schema.prisma`
- **Línea 573-577**: Actualizado comentario para documentar que `LeadProspect.establishmentId` usa clee

### 2. Script de Migración de Datos

#### `scripts/migrate-leadprospects-to-clee.js`
Script automático que:
1. Lee todos los registros de `lead_prospects`
2. Para cada UUID en `establishmentId`:
   - Busca el establishment en Mapa DB
   - Obtiene su `clee`
   - Actualiza el registro con el clee

### 3. Script Utilitario

#### `scripts/convert-all-prospects.js`
Script para convertir en batch todos los prospectos ASSIGNED a Lead:
- Requiere flag `--confirm` para evitar ejecuciones accidentales
- Procesa prospectos de forma secuencial
- Reporta éxitos y errores detalladamente

## Estado Actual

### Completado
1. Código actualizado para usar clee consistentemente
2. Datos existentes migrados de UUID a clee
3. Comentarios actualizados en schema y servicios
4. Búsquedas corregidas en `convertProspectToLead` y `getPartnerProspects`
5. Creación automática de leads cuando nivel cambia a LEAD
6. Notas automáticas en prospectos y leads
7. Logs detallados para debugging

### Verificar
1. **Frontend**: Asegurarse de que cuando llame a `/auto-qualify` envíe el **clee** (no UUID)
2. **Agentes SDK**: Verificar que al llamar a `/sdr/call-result` también use **clee**
3. **Twenty Sync**: Confirmar que la sincronización funcione correctamente con clees

## Flujos Afectados

### "Pasar a Lead" (Manual)
- CORREGIDO: Ahora busca establishment por clee en `convertProspectToLead`
- FUNCIONAL: El flow completo Contacto → Prospecto → Lead funciona
- AUTOMÁTICO: Al actualizar enrichment a nivel LEAD se crea el lead automáticamente

### "Calificar Automático"
- ACTUALIZADO: `sdrController` ahora documenta que usa clee
- PENDIENTE: Verificar que frontend y agentes SDK envíen clee

## Impacto en Twenty CRM

La sincronización con Twenty CRM **YA usaba clee** en `establishment_enrichments`, por lo que:
- No requiere cambios en `twentyService.js`
- No requiere cambios en `twentySyncService.js`
- Los filtros API ya usan `establecimientoId[eq]:clee`

## Próximos Pasos

1. **Probar "Pasar a Lead"** con un prospecto existente
2. **Probar "Calificar Automático"** end-to-end
3. **Verificar sincronización Twenty** para ambos flujos
4. **Actualizar frontend** si está enviando UUID en lugar de clee

## Notas Técnicas

### ¿Por qué clee y no UUID?
1. **Consistencia**: `establishment_enrichments` ya usa clee
2. **Estándar DENUE**: clee es el identificador oficial de INEGI
3. **Persistencia**: clee no cambia, UUID podría regenerarse
4. **Twenty CRM**: Ya usa clee como `establecimientoId`
5. **Menor impacto**: Solo 2 archivos vs 10+ si cambiábamos a UUID

### Formato de clee
- Formato: `25006722514004391000000000U4` (28 caracteres)
- Patrón: Generalmente empieza con código de estado (25 = Sinaloa)
- Contiene letras al final (U seguido de dígito verificador)

### Compatibilidad hacia atrás
El script de migración detecta automáticamente si un `establishmentId` ya es clee usando el patrón `/^\d{10}$/` para UUIDs numéricos. Si ya es clee, lo omite.

### Creación automática de Leads
Cuando se actualiza un enrichment a nivel LEAD:
1. Se busca el leadProspect correspondiente
2. Si existe y no está CONVERTED, se convierte automáticamente
3. Si no existe leadProspect, se crea el lead directamente
4. Se agregan notas descriptivas automáticamente
5. Se encola sincronización con Twenty CRM

### Logging mejorado
- `[ConvertProspectToLead]`: Logs detallados del proceso de conversión
- `[EnrichmentService]`: Logs de creación automática de leads
- `[VentasEnrichment]`: Logs de conversión de contacto a prospecto
