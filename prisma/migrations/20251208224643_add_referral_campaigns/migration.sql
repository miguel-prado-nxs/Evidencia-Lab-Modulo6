-- AlterEnum
ALTER TYPE "EstablishmentLevel" ADD VALUE 'CLIENT';

-- AlterTable
ALTER TABLE "establishment_enrichments" ADD COLUMN     "client_notes" TEXT,
ADD COLUMN     "client_since" TIMESTAMP(3),
ADD COLUMN     "client_status" TEXT,
ADD COLUMN     "product_purchased" TEXT,
ADD COLUMN     "purchase_amount" DECIMAL(10,2),
ADD COLUMN     "purchase_date" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "referral_campaigns" (
    "id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "utm_source" TEXT NOT NULL,
    "utm_medium" TEXT NOT NULL,
    "utm_campaign" TEXT NOT NULL,
    "utm_term" TEXT,
    "utm_content" TEXT,
    "full_link" TEXT NOT NULL,
    "short_link" TEXT,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "unique_clicks" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "referral_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "referral_campaigns_partner_id_idx" ON "referral_campaigns"("partner_id");

-- CreateIndex
CREATE INDEX "referral_campaigns_utm_campaign_idx" ON "referral_campaigns"("utm_campaign");

-- CreateIndex
CREATE INDEX "referral_campaigns_is_active_idx" ON "referral_campaigns"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "referral_campaigns_partner_id_utm_campaign_key" ON "referral_campaigns"("partner_id", "utm_campaign");

-- AddForeignKey
ALTER TABLE "referral_campaigns" ADD CONSTRAINT "referral_campaigns_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
