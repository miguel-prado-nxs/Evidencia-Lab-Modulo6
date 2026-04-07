-- CreateTable campaign_enrichments
-- Log de eventos de enriquecimiento por fuente (campaña vs panel de negocios)

CREATE TABLE IF NOT EXISTS "campaign_enrichments" (
    "id"                   TEXT NOT NULL,
    "establishment_id"     TEXT NOT NULL,
    "source"               VARCHAR(30) NOT NULL,
    "campaign_id"          TEXT,
    "campaign_contact_id"  TEXT,
    "conversation_id"      TEXT,
    "agent_stage"          VARCHAR(20),
    "level_reached"        VARCHAR(20),
    "enrichment_snapshot"  JSONB,
    "enriched_by"          TEXT,
    "enriched_by_type"     VARCHAR(20),
    "notes"                TEXT,
    "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_enrichments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "campaign_enrichments_establishment_id_idx"  ON "campaign_enrichments"("establishment_id");
CREATE INDEX IF NOT EXISTS "campaign_enrichments_source_idx"             ON "campaign_enrichments"("source");
CREATE INDEX IF NOT EXISTS "campaign_enrichments_campaign_id_idx"        ON "campaign_enrichments"("campaign_id");
CREATE INDEX IF NOT EXISTS "campaign_enrichments_agent_stage_idx"        ON "campaign_enrichments"("agent_stage");
CREATE INDEX IF NOT EXISTS "campaign_enrichments_level_reached_idx"      ON "campaign_enrichments"("level_reached");
CREATE INDEX IF NOT EXISTS "campaign_enrichments_conversation_id_idx"    ON "campaign_enrichments"("conversation_id");
CREATE INDEX IF NOT EXISTS "campaign_enrichments_enriched_by_idx"        ON "campaign_enrichments"("enriched_by");
CREATE INDEX IF NOT EXISTS "campaign_enrichments_created_at_idx"         ON "campaign_enrichments"("created_at" DESC);
