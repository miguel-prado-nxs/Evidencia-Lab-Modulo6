-- CreateTable
CREATE TABLE "call_leads" (
    "id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "establishment_id" TEXT,
    "preferred_time" TEXT NOT NULL DEFAULT 'now',
    "scheduled_at" TIMESTAMP(3),
    "call_status" TEXT NOT NULL DEFAULT 'pending',
    "call_summary" TEXT,
    "call_transcript" JSONB,
    "call_duration_seconds" INTEGER,
    "qualification_score" TEXT,
    "intent_score" INTEGER,
    "qualification_details" JSONB,
    "intent" TEXT,
    "fear" TEXT,
    "pain" TEXT,
    "desire" TEXT,
    "next_action" TEXT,
    "next_action_date" TIMESTAMP(3),
    "booking_method" TEXT,
    "converted_to_lead_id" TEXT,
    "partner_id" TEXT,
    "representative_name" TEXT,
    "source" TEXT NOT NULL DEFAULT 'sales_qualification',
    "utm_data" JSONB,
    "twilio_call_sid" TEXT,
    "called_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "call_leads_call_status_idx" ON "call_leads"("call_status");

-- CreateIndex
CREATE INDEX "call_leads_phone_idx" ON "call_leads"("phone");

-- CreateIndex
CREATE INDEX "call_leads_qualification_score_idx" ON "call_leads"("qualification_score");

-- CreateIndex
CREATE INDEX "call_leads_establishment_id_idx" ON "call_leads"("establishment_id");

-- CreateIndex
CREATE INDEX "call_leads_partner_id_idx" ON "call_leads"("partner_id");

-- CreateIndex
CREATE INDEX "call_leads_created_at_idx" ON "call_leads"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "call_leads" ADD CONSTRAINT "call_leads_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "idx_enrichments_call_status" RENAME TO "establishment_enrichments_call_status_idx";

-- RenameIndex
ALTER INDEX "idx_enrichments_enrichment_status" RENAME TO "establishment_enrichments_enrichment_status_idx";

-- RenameIndex
ALTER INDEX "idx_enrichments_strategy" RENAME TO "establishment_enrichments_strategy_idx";
