-- AddSDRCallTrackingColumns
-- Agregar columnas para rastrear llamadas del agente SDR
-- NOTA: NO se modifican columnas existentes, solo se agregan nuevas

-- Columna para resumen de llamada SDR (diferente de client_notes).
ALTER TABLE establishment_enrichments
ADD COLUMN IF NOT EXISTS call_summary TEXT;

-- Columna para estrategia SDR usada (A o B).
ALTER TABLE establishment_enrichments
ADD COLUMN IF NOT EXISTS strategy VARCHAR(10) CHECK (strategy IN ('A', 'B', 'N/A'));

-- Columna para número de intentos de llamada.
ALTER TABLE establishment_enrichments
ADD COLUMN IF NOT EXISTS call_attempts INTEGER DEFAULT 1 CHECK (call_attempts >= 0);

-- Columna para duración de llamada en segundos.
ALTER TABLE establishment_enrichments
ADD COLUMN IF NOT EXISTS call_duration_seconds INTEGER DEFAULT 0 CHECK (call_duration_seconds >= 0);

-- Columna para estado de la llamada.
ALTER TABLE establishment_enrichments
ADD COLUMN IF NOT EXISTS call_status VARCHAR(20) 
CHECK (call_status IN ('completed', 'no_answer', 'voicemail', 'failed'));

-- Columna para estado de enriquecimiento SDR.
ALTER TABLE establishment_enrichments
ADD COLUMN IF NOT EXISTS enrichment_status VARCHAR(30)
CHECK (enrichment_status IN ('contacted', 'identified', 'callback_scheduled', 'not_found', 'gatekeeper_blocked', 'dnc'));

-- Columna para información estructurada del gatekeeper (JSON).
ALTER TABLE establishment_enrichments
ADD COLUMN IF NOT EXISTS gatekeeper_info JSONB;

-- Columna para mejor horario de contacto sugerido.
ALTER TABLE establishment_enrichments
ADD COLUMN IF NOT EXISTS best_call_time VARCHAR(50);

-- Crear índices para mejorar consultas frecuentes.
CREATE INDEX IF NOT EXISTS idx_enrichments_enrichment_status 
ON establishment_enrichments(enrichment_status);

CREATE INDEX IF NOT EXISTS idx_enrichments_strategy 
ON establishment_enrichments(strategy);

CREATE INDEX IF NOT EXISTS idx_enrichments_call_status 
ON establishment_enrichments(call_status);

-- Comentarios para documentación de columnas.
COMMENT ON COLUMN establishment_enrichments.call_summary IS 'Resumen específico de la llamada SDR (2-3 oraciones sobre el resultado)';
COMMENT ON COLUMN establishment_enrichments.strategy IS 'Estrategia SDR usada: A (negocios pequeños 1-5 empleados), B (medianos/grandes 6+ empleados), N/A (no aplica)';
COMMENT ON COLUMN establishment_enrichments.call_attempts IS 'Número total de intentos de llamada realizados por SDR';
COMMENT ON COLUMN establishment_enrichments.call_duration_seconds IS 'Duración total de la última llamada en segundos';
COMMENT ON COLUMN establishment_enrichments.call_status IS 'Resultado técnico de la última llamada: completed, no_answer, voicemail, failed';
COMMENT ON COLUMN establishment_enrichments.enrichment_status IS 'Estado del proceso de enriquecimiento SDR del lead';
COMMENT ON COLUMN establishment_enrichments.gatekeeper_info IS 'Información del gatekeeper en formato JSON: {name: string, infoObtained: string[]}';
COMMENT ON COLUMN establishment_enrichments.best_call_time IS 'Mejor horario sugerido para llamar (ej: "Lunes-Viernes 10am-12pm")';