-- Integrator: allocate the next migration number and register in the migration journal.
CREATE TABLE capability_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  revision integer NOT NULL CHECK (revision > 0),
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL,
  action text NOT NULL CHECK (action IN ('record', 'revoke', 'supersede')),
  target_id uuid REFERENCES capability_evidence(id),
  receipt jsonb,
  reason text NOT NULL,
  reviewer_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((action = 'record' AND receipt IS NOT NULL AND target_id IS NULL)
    OR (action = 'supersede' AND receipt IS NOT NULL AND target_id IS NOT NULL)
    OR (action = 'revoke' AND receipt IS NULL AND target_id IS NOT NULL))
);
CREATE UNIQUE INDEX capability_evidence_company_revision ON capability_evidence(company_id, revision);
CREATE UNIQUE INDEX capability_evidence_company_idempotency ON capability_evidence(company_id, idempotency_key);
CREATE FUNCTION prevent_capability_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Capability evidence is append-only'; END;
$$;
CREATE TRIGGER capability_evidence_immutable BEFORE UPDATE OR DELETE ON capability_evidence
FOR EACH ROW EXECUTE FUNCTION prevent_capability_evidence_mutation();
