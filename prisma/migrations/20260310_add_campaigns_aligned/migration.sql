-- CreateEnum para tipos de campaña y estados actualizados (solo si no existen)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CampaignType') THEN
        CREATE TYPE "CampaignType" AS ENUM ('ACQUISITION', 'NURTURING', 'REACTIVATION');
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CampaignStatus') THEN
        CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ContactStatus') THEN
        CREATE TYPE "ContactStatus" AS ENUM ('PENDING', 'CALLING', 'CALLED', 'RESPONDED', 'SENT', 'DELIVERED', 'VISITED', 'CONVERTED', 'FAILED');
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CouponStatus') THEN
        CREATE TYPE "CouponStatus" AS ENUM ('GENERATED', 'SENT', 'VISITED', 'CONVERTED', 'EXPIRED');
    END IF;
END $$;

-- CreateTable campaigns (alineada con frontend)
CREATE TABLE IF NOT EXISTS "campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "type" "CampaignType",
    
    -- Segmentación geográfica
    "center_lat" DOUBLE PRECISION,
    "center_lng" DOUBLE PRECISION,
    "radius_meters" INTEGER,
    
    -- Filtros específicos (alineados con frontend)
    "activity_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "employee_ranges" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "filters" JSONB,
    
    -- Agente y oferta
    "agent_config_id" TEXT,
    "agent_config_name" TEXT,
    "offer" TEXT,
    "coupon_prefix" TEXT,
    
    -- Métricas de contactos
    "total_contacts" INTEGER NOT NULL DEFAULT 0,
    "total_called" INTEGER NOT NULL DEFAULT 0,
    "total_responded" INTEGER NOT NULL DEFAULT 0,
    "total_converted" INTEGER NOT NULL DEFAULT 0,
    "total_failed" INTEGER NOT NULL DEFAULT 0,
    
    -- Métricas de cupones
    "coupons_sent" INTEGER NOT NULL DEFAULT 0,
    "coupons_visited" INTEGER NOT NULL DEFAULT 0,
    "coupons_converted" INTEGER NOT NULL DEFAULT 0,
    
    -- Metadata
    "created_by" TEXT,
    "partner_id" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable campaign_contacts
CREATE TABLE IF NOT EXISTS "campaign_contacts" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    
    -- Snapshot de datos
    "establishment_name" TEXT,
    "establishment_phone" TEXT,
    "establishment_data" JSONB,
    
    -- Tracking de estados (con nuevos estados alineados)
    "status" "ContactStatus" NOT NULL DEFAULT 'PENDING',
    "sent_at" TIMESTAMP(3),
    "visited_at" TIMESTAMP(3),
    "converted_at" TIMESTAMP(3),
    
    -- Cupón asignado
    "coupon_id" TEXT,
    
    -- Metadata de envío
    "message_id" TEXT,
    "error_reason" TEXT,
    
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable campaign_coupons
CREATE TABLE IF NOT EXISTS "campaign_coupons" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "offer" TEXT NOT NULL,
    
    -- Tracking
    "status" "CouponStatus" NOT NULL DEFAULT 'GENERATED',
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "visited_at" TIMESTAMP(3),
    "converted_at" TIMESTAMP(3),
    
    -- Metadata
    "visit_count" INTEGER NOT NULL DEFAULT 0,
    "last_visited_at" TIMESTAMP(3),
    "conversion_data" JSONB,
    
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_coupons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_contacts_campaign_id_establishment_id_key" ON "campaign_contacts"("campaign_id", "establishment_id");

CREATE UNIQUE INDEX IF NOT EXISTS "campaign_coupons_code_key" ON "campaign_coupons"("code");

CREATE INDEX IF NOT EXISTS "campaigns_status_idx" ON "campaigns"("status");
CREATE INDEX IF NOT EXISTS "campaigns_type_idx" ON "campaigns"("type");
CREATE INDEX IF NOT EXISTS "campaigns_created_by_idx" ON "campaigns"("created_by");
CREATE INDEX IF NOT EXISTS "campaigns_partner_id_idx" ON "campaigns"("partner_id");
CREATE INDEX IF NOT EXISTS "campaigns_created_at_idx" ON "campaigns"("created_at" DESC);

CREATE INDEX IF NOT EXISTS "campaign_contacts_campaign_id_idx" ON "campaign_contacts"("campaign_id");
CREATE INDEX IF NOT EXISTS "campaign_contacts_establishment_id_idx" ON "campaign_contacts"("establishment_id");
CREATE INDEX IF NOT EXISTS "campaign_contacts_status_idx" ON "campaign_contacts"("status");
CREATE INDEX IF NOT EXISTS "campaign_contacts_sent_at_idx" ON "campaign_contacts"("sent_at");

CREATE INDEX IF NOT EXISTS "campaign_coupons_campaign_id_idx" ON "campaign_coupons"("campaign_id");
CREATE INDEX IF NOT EXISTS "campaign_coupons_code_idx" ON "campaign_coupons"("code");
CREATE INDEX IF NOT EXISTS "campaign_coupons_status_idx" ON "campaign_coupons"("status");

-- AddForeignKey
ALTER TABLE "campaign_contacts" ADD CONSTRAINT "campaign_contacts_campaign_id_fkey" 
FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "campaign_contacts" ADD CONSTRAINT "campaign_contacts_coupon_id_fkey" 
FOREIGN KEY ("coupon_id") REFERENCES "campaign_coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "campaign_coupons" ADD CONSTRAINT "campaign_coupons_campaign_id_fkey" 
FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
