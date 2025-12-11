-- Migración: Eliminar FK constraints de establishmentId
-- Los establecimientos están en Mapa DB (DATABASE_URL_RESTAURANTES), no en Partners DB
-- Por lo tanto, las FK constraints deben eliminarse para permitir referencias cross-database

-- Eliminar FK constraint de establishment_enrichments
ALTER TABLE "establishment_enrichments" 
DROP CONSTRAINT IF EXISTS "establishment_enrichments_establishment_id_fkey";

-- Eliminar FK constraint de lead_prospects
ALTER TABLE "lead_prospects" 
DROP CONSTRAINT IF EXISTS "lead_prospects_establishment_id_fkey";

-- Eliminar la tabla establishments de Partners DB si existe
-- (Los datos reales están en Mapa DB)
-- DROP TABLE IF EXISTS "establishments" CASCADE;

-- Eliminar la tabla geo_zones si existe (también está en Mapa DB)
-- Comentado por si acaso la necesitas en Partners DB
-- DROP TABLE IF EXISTS "geo_zones" CASCADE;

