-- Eliminar columnas antiguas de validez que ya no se usan
-- Las nuevas columnas son: valid_from (TIMESTAMP) y valid_until (TIMESTAMP)

-- Eliminar columnas antiguas si existen
ALTER TABLE coupon_templates DROP COLUMN IF EXISTS valid_from_hour;
ALTER TABLE coupon_templates DROP COLUMN IF EXISTS valid_until_hour;

-- Nota: valid_days se mantiene porque se usa para especificar días de la semana válidos
-- (por ejemplo: ["monday", "tuesday", "wednesday"])
