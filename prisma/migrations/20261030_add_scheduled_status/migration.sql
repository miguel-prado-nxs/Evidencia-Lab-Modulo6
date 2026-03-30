
-- Add SCHEDULED to CampaignStatus enum
DO $$
BEGIN
    ALTER TYPE "CampaignStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED' AFTER 'DRAFT';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add SCHEDULED to ContactStatus enum
DO $$
BEGIN
    ALTER TYPE "ContactStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED' AFTER 'PENDING';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add scheduled_at column to campaigns table
ALTER TABLE "campaigns"
ADD COLUMN IF NOT EXISTS "scheduled_at" TIMESTAMP(3);

-- Add index for scheduled_at
CREATE INDEX IF NOT EXISTS "campaigns_scheduled_at_idx" ON "campaigns"("scheduled_at");