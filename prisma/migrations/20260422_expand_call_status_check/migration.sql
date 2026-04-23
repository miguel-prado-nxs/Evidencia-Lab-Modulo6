-- Expand call_status check constraint to include campaign outcomes
-- This migration updates the check constraint to allow all possible outcomes from the campaign stages

-- Drop the old constraint
ALTER TABLE establishment_enrichments
DROP CONSTRAINT IF EXISTS establishment_enrichments_call_status_check;

-- Add the new constraint with all possible outcomes
ALTER TABLE establishment_enrichments
ADD CONSTRAINT establishment_enrichments_call_status_check
CHECK (call_status IN (
  -- Discovery outcomes (PLG)
  'INTERESTED', 'ADVANCE_TO_ACTIVATION', 'FOLLOW_UP_LATER', 'NOT_INTERESTED', 'WRONG_NUMBER', 'NO_ANSWER', 'VOICEMAIL',
  -- Activation outcomes (PLG)
  'ACTIVATED', 'DEMO_SCHEDULED', 'DEMO_DECLINED',
  -- Qualification outcomes (PLG)
  'QUALIFIED', 'NOT_QUALIFIED', 'FOLLOW_UP', 'DISQUALIFIED',
  -- Conversion outcomes (PLG)
  'CLOSED_WON', 'READY', 'NEEDS_TIME', 'NEEDS_VALIDATION', 'NOT_NOW', 'LOST',
  -- Legacy values
  'completed', 'no_answer', 'voicemail', 'failed'
));


-- Expand call_status field from VARCHAR(20) to VARCHAR(50)
-- This allows storing longer outcome values like "ADVANCE_TO_ACTIVATION" (21 chars)
 
ALTER TABLE establishment_enrichments
ALTER COLUMN call_status TYPE VARCHAR(50);