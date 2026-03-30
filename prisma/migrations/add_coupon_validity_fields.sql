-- Add validity fields to coupon_templates
ALTER TABLE "coupon_templates" 
ADD COLUMN IF NOT EXISTS "valid_from_hour" INTEGER,
ADD COLUMN IF NOT EXISTS "valid_until_hour" INTEGER,
ADD COLUMN IF NOT EXISTS "valid_days" TEXT[] DEFAULT '{}';

-- Add validity fields to campaign_coupons
ALTER TABLE "campaign_coupons"
ADD COLUMN IF NOT EXISTS "valid_from" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "valid_until" TIMESTAMP(3);

-- Add comments for documentation
COMMENT ON COLUMN "coupon_templates"."valid_from_hour" IS 'Hora de inicio de validez (0-23)';
COMMENT ON COLUMN "coupon_templates"."valid_until_hour" IS 'Hora de fin de validez (0-23)';
COMMENT ON COLUMN "coupon_templates"."valid_days" IS 'Días de la semana válidos: monday, tuesday, etc.';
COMMENT ON COLUMN "campaign_coupons"."valid_from" IS 'Fecha/hora desde cuándo es válido el cupón';
COMMENT ON COLUMN "campaign_coupons"."valid_until" IS 'Fecha/hora hasta cuándo es válido el cupón';
