-- AlterTable: Add agent_config_id to sdr_interactions
ALTER TABLE "sdr_interactions" ADD COLUMN "agent_config_id" UUID;

-- CreateIndex
CREATE INDEX "sdr_interactions_agent_config_id_idx" ON "sdr_interactions"("agent_config_id");

-- AlterTable: Add agent_config_id to call_leads
ALTER TABLE "call_leads" ADD COLUMN "agent_config_id" UUID;

-- CreateIndex
CREATE INDEX "call_leads_agent_config_id_idx" ON "call_leads"("agent_config_id");
