-- REVIEW PROPOSAL ONLY. Not a numbered migration and not registered in the journal.
-- Allocate the next migration identity in the integrating branch after schema review.
BEGIN;
CREATE TABLE mimouse_wecom_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bot_hash text NOT NULL,
  config jsonb NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  activation_token uuid,
  state text NOT NULL DEFAULT 'disabled',
  lease_token uuid,
  lease_expires_at timestamptz,
  gap_detected boolean NOT NULL DEFAULT false,
  imported integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX mimouse_wecom_global_bot ON mimouse_wecom_connections(bot_hash);
CREATE INDEX mimouse_wecom_company ON mimouse_wecom_connections(company_id, created_at);
ALTER TABLE mimouse_feedback_inbox DROP CONSTRAINT mimouse_feedback_shape;
ALTER TABLE mimouse_feedback_inbox ADD CONSTRAINT mimouse_feedback_shape CHECK (
  ingestion_mode IN ('manual_import','provider_fetch','provider_push')
  AND status = 'candidate' AND redaction_version = 1
  AND source_kind IN ('manual','application_log','langfuse','wecom_smart_bot')
  AND length(title) BETWEEN 1 AND 240 AND length(body) BETWEEN 1 AND 32000
);
COMMIT;
-- Rollback is an operator-controlled data migration, not DROP TABLE by default.
-- Disable worker/connection first, await lease expiry, and retain inbox evidence.
-- Restoring the old constraint requires handling existing provider_push rows without
-- relabeling them provider_fetch or manual_import. Back up and explicitly approve
-- any destructive rollback; code rollback alone must not destroy received evidence.
