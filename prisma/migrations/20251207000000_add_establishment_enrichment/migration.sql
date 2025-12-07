-- CreateEnum
CREATE TYPE "EstablishmentLevel" AS ENUM ('ESTABLISHMENT', 'CONTACT', 'PROSPECT', 'LEAD');

-- CreateTable
CREATE TABLE "establishment_enrichments" (
    "id" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "decision_maker_name" TEXT,
    "decision_maker_position" TEXT,
    "decision_maker_phone" TEXT,
    "decision_maker_whatsapp" TEXT,
    "decision_maker_email" TEXT,
    "intent" TEXT,
    "fear" TEXT,
    "pain" TEXT,
    "desire" TEXT,
    "level" "EstablishmentLevel" NOT NULL DEFAULT 'ESTABLISHMENT',
    "enriched_by" TEXT,
    "enriched_at" TIMESTAMP(3),
    "last_updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "establishment_enrichments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "establishment_enrichments_establishment_id_key" ON "establishment_enrichments"("establishment_id");

-- CreateIndex
CREATE INDEX "establishment_enrichments_level_idx" ON "establishment_enrichments"("level");

-- CreateIndex
CREATE INDEX "establishment_enrichments_establishment_id_idx" ON "establishment_enrichments"("establishment_id");

-- CreateIndex
CREATE INDEX "establishment_enrichments_enriched_by_idx" ON "establishment_enrichments"("enriched_by");

-- AddForeignKey
ALTER TABLE "establishment_enrichments" ADD CONSTRAINT "establishment_enrichments_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

