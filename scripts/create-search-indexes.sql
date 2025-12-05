-- Script para crear índices GIN de búsqueda rápida
-- Estos índices mejoran significativamente las búsquedas parciales de texto

-- Habilitar la extensión pg_trgm para búsquedas trigram
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Índice GIN para búsqueda por nombre de establecimiento
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_establishments_name_trgm 
ON establishments USING gin (name gin_trgm_ops);

-- Índice GIN para búsqueda por nombre de actividad
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_establishments_activity_trgm 
ON establishments USING gin (activity_name gin_trgm_ops);

-- Índice GIN para búsqueda por nombre de municipio
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_establishments_municipality_trgm 
ON establishments USING gin (municipality_name gin_trgm_ops);

-- Índice GIN para búsqueda por nombre de estado
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_establishments_state_trgm 
ON establishments USING gin (state_name gin_trgm_ops);

-- Índice compuesto para filtros comunes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_establishments_activity_state 
ON establishments (activity_code, state_code);

-- Índice para geo_zones por tipo y nombre
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_geo_zones_name_trgm 
ON geo_zones USING gin (name gin_trgm_ops);

-- Índice para búsqueda rápida por tipo de zona
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_geo_zones_type_count 
ON geo_zones (type, total_establishments DESC);

-- Verificar índices creados
SELECT 
    indexname, 
    indexdef 
FROM pg_indexes 
WHERE tablename IN ('establishments', 'geo_zones')
ORDER BY tablename, indexname;

