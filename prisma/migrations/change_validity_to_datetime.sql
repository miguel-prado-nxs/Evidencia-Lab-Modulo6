-- Migración para cambiar campos de validez de Int (horas) a DateTime completos
-- Ejecutar manualmente en la base de datos

-- 1. Eliminar las columnas antiguas de horas
ALTER TABLE coupon_templates DROP COLUMN IF EXISTS valid_from_hour;
ALTER TABLE coupon_templates DROP COLUMN IF EXISTS valid_until_hour;

-- 2. Agregar las nuevas columnas de DateTime
ALTER TABLE coupon_templates ADD COLUMN IF NOT EXISTS valid_from TIMESTAMP(3);
ALTER TABLE coupon_templates ADD COLUMN IF NOT EXISTS valid_until TIMESTAMP(3);

-- Comentarios:
-- valid_from: Fecha y hora de inicio de validez del cupón
-- valid_until: Fecha y hora de fin de validez del cupón
-- Ambos campos son opcionales (nullable)
