-- Migration: Extend A/B Testing Schema for SDR Call Tracking
-- Adds detailed logging, attempt tracking, and comprehensive metrics

-- 1. Add fields to ab_test_contacts for attempt tracking
ALTER TABLE "ab_test_contacts" 
ADD COLUMN IF NOT EXISTS "attempt_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "last_attempted_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "assigned_variant_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS "batch_id" TEXT,
ADD COLUMN IF NOT EXISTS "contact_hash" TEXT;

-- 2. Add user_id to ab_tests for ownership
ALTER TABLE "ab_tests" 
ADD COLUMN IF NOT EXISTS "user_id" TEXT,
ADD COLUMN IF NOT EXISTS "completion_criteria" JSONB,
ADD COLUMN IF NOT EXISTS "config" JSONB;

-- 3. Create ab_test_call_logs table for detailed call tracking
CREATE TABLE IF NOT EXISTS "ab_test_call_logs" (
    "id" TEXT NOT NULL,
    "ab_test_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "agent_config_id" TEXT NOT NULL,
    
    "establishment_id" TEXT NOT NULL,
    "establishment_name" TEXT,
    "phone" TEXT,
    "employee_range" TEXT,
    "address" TEXT,
    
    "call_id" TEXT,
    "call_attempt" INTEGER NOT NULL DEFAULT 1,
    "batch_id" TEXT,
    
    "initiated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "connected_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    
    "outcome" TEXT,
    "duration_sec" INTEGER,
    
    "prospect_created" BOOLEAN NOT NULL DEFAULT false,
    "prospect_id" TEXT,
    "next_step" TEXT,
    
    "objections_count" INTEGER DEFAULT 0,
    "objections_detail" JSONB,
    
    "call_transcript" TEXT,
    "call_recording_url" TEXT,
    
    "error_message" TEXT,
    "metadata" JSONB,
    
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ab_test_call_logs_pkey" PRIMARY KEY ("id")
);

-- 4. Create ab_test_events table for event logging
CREATE TABLE IF NOT EXISTS "ab_test_events" (
    "id" TEXT NOT NULL,
    "ab_test_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "establishment_id" TEXT,
    "call_log_id" TEXT,
    
    "event_type" TEXT NOT NULL,
    "event_data" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT "ab_test_events_pkey" PRIMARY KEY ("id")
);

-- 5. Create ab_test_candidates table if not exists (for holding candidates)
CREATE TABLE IF NOT EXISTS "ab_test_candidates" (
    "establishment_id" TEXT NOT NULL,
    "user_id" TEXT,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    
    CONSTRAINT "ab_test_candidates_pkey" PRIMARY KEY ("establishment_id")
);

-- 6. Add indexes for performance
CREATE INDEX IF NOT EXISTS "ab_test_call_logs_ab_test_id_idx" ON "ab_test_call_logs"("ab_test_id");
CREATE INDEX IF NOT EXISTS "ab_test_call_logs_variant_id_idx" ON "ab_test_call_logs"("variant_id");
CREATE INDEX IF NOT EXISTS "ab_test_call_logs_establishment_id_idx" ON "ab_test_call_logs"("establishment_id");
CREATE INDEX IF NOT EXISTS "ab_test_call_logs_outcome_idx" ON "ab_test_call_logs"("outcome");
CREATE INDEX IF NOT EXISTS "ab_test_call_logs_call_id_idx" ON "ab_test_call_logs"("call_id");

CREATE INDEX IF NOT EXISTS "ab_test_events_ab_test_id_idx" ON "ab_test_events"("ab_test_id");
CREATE INDEX IF NOT EXISTS "ab_test_events_event_type_idx" ON "ab_test_events"("event_type");
CREATE INDEX IF NOT EXISTS "ab_test_events_timestamp_idx" ON "ab_test_events"("timestamp");

CREATE INDEX IF NOT EXISTS "ab_test_contacts_batch_id_idx" ON "ab_test_contacts"("batch_id");
CREATE INDEX IF NOT EXISTS "ab_test_contacts_contact_hash_idx" ON "ab_test_contacts"("contact_hash");

-- 7. Add foreign key constraints
ALTER TABLE "ab_test_call_logs" 
ADD CONSTRAINT "ab_test_call_logs_ab_test_id_fkey" 
FOREIGN KEY ("ab_test_id") REFERENCES "ab_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ab_test_call_logs" 
ADD CONSTRAINT "ab_test_call_logs_variant_id_fkey" 
FOREIGN KEY ("variant_id") REFERENCES "ab_test_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ab_test_events" 
ADD CONSTRAINT "ab_test_events_ab_test_id_fkey" 
FOREIGN KEY ("ab_test_id") REFERENCES "ab_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 8. Add unique constraint for contact hash to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS "ab_test_contacts_hash_unique" 
ON "ab_test_contacts"("contact_hash") 
WHERE "contact_hash" IS NOT NULL;
