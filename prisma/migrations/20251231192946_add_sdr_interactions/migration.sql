-- CreateTable
CREATE TABLE "sdr_interactions" (
    "id" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "call_status" VARCHAR(30),
    "enrichment_status" VARCHAR(30),
    "decision_maker_found" BOOLEAN NOT NULL DEFAULT false,
    "decision_maker_name" TEXT,
    "decision_maker_role" TEXT,
    "call_summary" TEXT,
    "call_duration_seconds" INTEGER,
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "strategy" VARCHAR(10),
    "gatekeeper_info" JSONB,
    "twilio_call_sid" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sdr_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sdr_interactions_establishment_id_idx" ON "sdr_interactions"("establishment_id");

-- CreateIndex
CREATE INDEX "sdr_interactions_call_status_idx" ON "sdr_interactions"("call_status");

-- CreateIndex
CREATE INDEX "sdr_interactions_enrichment_status_idx" ON "sdr_interactions"("enrichment_status");

-- CreateIndex
CREATE INDEX "sdr_interactions_strategy_idx" ON "sdr_interactions"("strategy");

-- CreateIndex
CREATE INDEX "sdr_interactions_decision_maker_found_idx" ON "sdr_interactions"("decision_maker_found");

-- CreateIndex
CREATE INDEX "sdr_interactions_created_at_idx" ON "sdr_interactions"("created_at");
