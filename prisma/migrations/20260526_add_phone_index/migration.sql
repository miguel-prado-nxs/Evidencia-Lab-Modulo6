-- Índice en establishment_phone para deduplicación cross-campaign eficiente.
-- Operación no destructiva: solo agrega un índice.
CREATE INDEX IF NOT EXISTS "campaign_contacts_establishment_phone_idx"
  ON "campaign_contacts"("establishment_phone");
