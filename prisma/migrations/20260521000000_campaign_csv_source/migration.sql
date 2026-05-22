-- Add CSV source tracking fields to campaigns
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "contact_source"    TEXT NOT NULL DEFAULT 'GEO',
  ADD COLUMN IF NOT EXISTS "csv_original_name" TEXT,
  ADD COLUMN IF NOT EXISTS "csv_rows_total"    INTEGER,
  ADD COLUMN IF NOT EXISTS "csv_rows_valid"    INTEGER,
  ADD COLUMN IF NOT EXISTS "csv_rows_rejected" INTEGER;

-- Add source type tracking to campaign_contacts
ALTER TABLE "campaign_contacts"
  ADD COLUMN IF NOT EXISTS "source_type" TEXT NOT NULL DEFAULT 'GEO';
