-- CreateTable
CREATE TABLE "restaurant_profiles" (
    "id" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "restaurant_id" INTEGER,
    "direccion_id" INTEGER,
    "business_name" TEXT NOT NULL,
    "cuisine_type" TEXT,
    "contact_phone" TEXT,
    "contact_email" TEXT,
    "contact_whatsapp" TEXT,
    "timezone" TEXT,
    "address" JSONB,
    "logo_url" TEXT,
    "step1_completed" BOOLEAN NOT NULL DEFAULT false,
    "step2_completed" BOOLEAN NOT NULL DEFAULT false,
    "step3_completed" BOOLEAN NOT NULL DEFAULT false,
    "provision_status" TEXT NOT NULL DEFAULT 'pending',
    "provisioned_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurant_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_profiles_establishment_id_key" ON "restaurant_profiles"("establishment_id");

-- CreateIndex
CREATE INDEX "restaurant_profiles_lead_id_idx" ON "restaurant_profiles"("lead_id");

-- CreateIndex
CREATE INDEX "restaurant_profiles_restaurant_id_idx" ON "restaurant_profiles"("restaurant_id");

-- CreateIndex
CREATE INDEX "restaurant_profiles_provision_status_idx" ON "restaurant_profiles"("provision_status");
