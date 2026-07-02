-- Migration: add_interaction_type_to_twenty_sync_job
-- Adds type, payload, dedupe_key, max_attempts to twenty_sync_jobs
-- Existing rows get type=PIPELINE by default — behavior unchanged

-- 1. Create enum (skip if already exists)
DO $$ BEGIN
  CREATE TYPE "TwentySyncJobType" AS ENUM ('PIPELINE', 'INTERACTION');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. Add new columns
ALTER TABLE "twenty_sync_jobs"
  ADD COLUMN IF NOT EXISTS "type"         "TwentySyncJobType" NOT NULL DEFAULT 'PIPELINE',
  ADD COLUMN IF NOT EXISTS "payload"      JSONB,
  ADD COLUMN IF NOT EXISTS "dedupe_key"   TEXT,
  ADD COLUMN IF NOT EXISTS "max_attempts" INTEGER;

-- 3. Unique constraint on dedupe_key
DO $$ BEGIN
  ALTER TABLE "twenty_sync_jobs" ADD CONSTRAINT "twenty_sync_jobs_dedupe_key_key" UNIQUE ("dedupe_key");
EXCEPTION
  WHEN duplicate_table THEN NULL;
END $$;

-- 4. Composite index for worker (type + status + next_run_at)
CREATE INDEX IF NOT EXISTS "twenty_sync_jobs_type_status_next_run_at_idx"
  ON "twenty_sync_jobs" ("type", "status", "next_run_at");
