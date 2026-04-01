-- Expandir check constraint de enrichment_status para incluir stages del funnel de agentes ElevenLabs
ALTER TABLE establishment_enrichments
DROP CONSTRAINT IF EXISTS establishment_enrichments_enrichment_status_check;

ALTER TABLE establishment_enrichments
ADD CONSTRAINT establishment_enrichments_enrichment_status_check
CHECK (enrichment_status IN (
  -- SDR legacy
  'contacted',
  'identified',
  'callback_scheduled',
  'not_found',
  'gatekeeper_blocked',
  'dnc',
  -- Funnel agents
  'discovery_completed',
  'activation_completed',
  'qualification_completed',
  'conversion_completed'
));
