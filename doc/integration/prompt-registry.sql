-- Integration proposal: parent assigns migration number and generates snapshot/journal.
CREATE TABLE mimouse_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id),
  prompt_key text NOT NULL, selected_revision_id uuid, head_receipt_id uuid,
  CONSTRAINT mimouse_prompt_key_format CHECK (prompt_key ~ '^[a-z][a-z0-9_-]{0,79}$')
);
CREATE UNIQUE INDEX mimouse_prompt_key ON mimouse_prompts(company_id, prompt_key);
CREATE UNIQUE INDEX mimouse_prompt_identity ON mimouse_prompts(company_id, id);
CREATE TABLE mimouse_prompt_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, prompt_id uuid NOT NULL,
  content text NOT NULL, content_hash text NOT NULL, request_id uuid NOT NULL, request_digest text NOT NULL,
  actor_user_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, prompt_id) REFERENCES mimouse_prompts(company_id, id),
  CONSTRAINT mimouse_prompt_content_size CHECK (octet_length(content) BETWEEN 1 AND 128000),
  CONSTRAINT mimouse_prompt_content_hash CHECK (content_hash ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX mimouse_prompt_revision_request ON mimouse_prompt_revisions(company_id, request_id);
CREATE UNIQUE INDEX mimouse_prompt_revision_identity ON mimouse_prompt_revisions(company_id, prompt_id, id);
CREATE TABLE mimouse_prompt_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, prompt_id uuid NOT NULL,
  action text NOT NULL, previous_receipt_id uuid REFERENCES mimouse_prompt_receipts(id),
  before_revision_id uuid, selected_revision_id uuid, rollback_of_receipt_id uuid REFERENCES mimouse_prompt_receipts(id),
  request_id uuid NOT NULL, request_digest text NOT NULL, actor_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, prompt_id) REFERENCES mimouse_prompts(company_id, id),
  FOREIGN KEY (company_id, prompt_id, before_revision_id) REFERENCES mimouse_prompt_revisions(company_id, prompt_id, id),
  FOREIGN KEY (company_id, prompt_id, selected_revision_id) REFERENCES mimouse_prompt_revisions(company_id, prompt_id, id),
  CONSTRAINT mimouse_prompt_action CHECK (
    (action = 'promote' AND selected_revision_id IS NOT NULL AND rollback_of_receipt_id IS NULL) OR
    (action = 'rollback' AND rollback_of_receipt_id IS NOT NULL AND previous_receipt_id IS NOT NULL AND rollback_of_receipt_id = previous_receipt_id)),
  CONSTRAINT mimouse_prompt_transition CHECK (before_revision_id IS DISTINCT FROM selected_revision_id)
);
CREATE UNIQUE INDEX mimouse_prompt_receipt_request ON mimouse_prompt_receipts(company_id, request_id);
CREATE UNIQUE INDEX mimouse_prompt_receipt_identity ON mimouse_prompt_receipts(company_id, prompt_id, id);
ALTER TABLE mimouse_prompt_receipts ADD CONSTRAINT mimouse_prompt_previous_scope
  FOREIGN KEY (company_id, prompt_id, previous_receipt_id) REFERENCES mimouse_prompt_receipts(company_id, prompt_id, id);
ALTER TABLE mimouse_prompt_receipts ADD CONSTRAINT mimouse_prompt_rollback_scope
  FOREIGN KEY (company_id, prompt_id, rollback_of_receipt_id) REFERENCES mimouse_prompt_receipts(company_id, prompt_id, id);
ALTER TABLE mimouse_prompts ADD CONSTRAINT mimouse_prompt_selected_scope
  FOREIGN KEY (company_id, id, selected_revision_id) REFERENCES mimouse_prompt_revisions(company_id, prompt_id, id);
ALTER TABLE mimouse_prompts ADD CONSTRAINT mimouse_prompt_head_scope
  FOREIGN KEY (company_id, id, head_receipt_id) REFERENCES mimouse_prompt_receipts(company_id, prompt_id, id);
-- Append-only history is enforced even against accidental UPDATE/DELETE code paths.
-- Deliberately no cascade deletion: retention/purge is a separate authorized policy.
CREATE FUNCTION mimouse_prompt_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'prompt_history_immutable' USING ERRCODE = '23514'; END;
$$;
CREATE TRIGGER mimouse_prompt_revisions_immutable BEFORE UPDATE OR DELETE ON mimouse_prompt_revisions
  FOR EACH ROW EXECUTE FUNCTION mimouse_prompt_history_immutable();
CREATE TRIGGER mimouse_prompt_receipts_immutable BEFORE UPDATE OR DELETE ON mimouse_prompt_receipts
  FOR EACH ROW EXECUTE FUNCTION mimouse_prompt_history_immutable();
