-- Historical review proposal, superseded by 0357_deep_nehzno.sql.
-- Application and fixture setup must use the normal migration chain only.
-- REVIEW PROPOSAL ONLY. Central integration generates/assigns the migration.
-- Do not execute alongside generated CREATE TABLE statements.
CREATE TABLE mimouse_private_prompt_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id),
  prompt_id uuid NOT NULL, revision_id uuid NOT NULL, head_receipt_id uuid,
  revision_hash text NOT NULL, request_id uuid NOT NULL, request_digest text NOT NULL,
  actor_user_id text NOT NULL, actor_session_id text NOT NULL,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  dataset_id uuid NOT NULL, dataset_hash text NOT NULL, case_id uuid NOT NULL,
  skill_version_id uuid NOT NULL REFERENCES company_skill_versions(id) ON DELETE RESTRICT,
  approval_snapshot jsonb, config_digest text NOT NULL, skill_version_hash text NOT NULL, secret_value_hash text NOT NULL,
  status text NOT NULL DEFAULT 'awaiting_confirmation',
  issue_id uuid REFERENCES issues(id) ON DELETE RESTRICT,
  wakeup_request_id uuid REFERENCES agent_wakeup_requests(id) ON DELETE RESTRICT,
  heartbeat_run_id uuid REFERENCES heartbeat_runs(id) ON DELETE RESTRICT,
  attempt_id uuid, prepared jsonb, spawned_at timestamptz, private_result jsonb, error_code text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mimouse_private_prompt_test_revision FOREIGN KEY(company_id,prompt_id,revision_id)
    REFERENCES mimouse_prompt_revisions(company_id,prompt_id,id) ON DELETE RESTRICT,
  CONSTRAINT mimouse_private_prompt_test_receipt FOREIGN KEY(company_id,prompt_id,head_receipt_id)
    REFERENCES mimouse_prompt_receipts(company_id,prompt_id,id) ON DELETE RESTRICT,
  CONSTRAINT mimouse_private_prompt_test_dataset FOREIGN KEY(company_id,dataset_id)
    REFERENCES mimouse_evaluation_datasets(company_id,id) ON DELETE RESTRICT,
  CONSTRAINT mimouse_private_prompt_test_confirmation CHECK(status <> 'awaiting_confirmation' OR (issue_id IS NULL AND wakeup_request_id IS NULL AND heartbeat_run_id IS NULL AND attempt_id IS NULL AND prepared IS NULL AND private_result IS NULL)),
  CONSTRAINT mimouse_private_prompt_test_state CHECK(status IN ('awaiting_confirmation','pending_harness','pending_wake','queued','prepared','spawned','completed','failed','unknown','cancelled')),
  CONSTRAINT mimouse_private_prompt_test_witness CHECK(status NOT IN ('prepared','spawned','completed') OR (prepared IS NOT NULL AND attempt_id IS NOT NULL AND heartbeat_run_id IS NOT NULL)),
  CONSTRAINT mimouse_private_prompt_test_spawned CHECK(status NOT IN ('spawned','completed') OR spawned_at IS NOT NULL),
  CONSTRAINT mimouse_private_prompt_test_result CHECK(status <> 'completed' OR private_result IS NOT NULL)
);
CREATE UNIQUE INDEX mimouse_private_prompt_test_request ON mimouse_private_prompt_tests(company_id,request_id);
CREATE UNIQUE INDEX mimouse_private_prompt_test_issue ON mimouse_private_prompt_tests(issue_id);
CREATE UNIQUE INDEX mimouse_private_prompt_test_wake ON mimouse_private_prompt_tests(wakeup_request_id);
CREATE UNIQUE INDEX mimouse_private_prompt_test_run ON mimouse_private_prompt_tests(heartbeat_run_id);
CREATE UNIQUE INDEX mimouse_private_prompt_test_attempt ON mimouse_private_prompt_tests(attempt_id);
-- Includes failed/cancelled/skipped rows: none is authority for a new paid attempt.
CREATE UNIQUE INDEX agent_wakeup_requests_private_prompt_test_uq ON agent_wakeup_requests(company_id,idempotency_key)
  WHERE idempotency_key LIKE 'private-prompt-test:%';
