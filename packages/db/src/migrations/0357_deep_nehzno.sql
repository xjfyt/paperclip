-- Transactional schema and at-most-once fence: apply in a maintenance window.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '120s';
--> statement-breakpoint
CREATE TABLE "mimouse_private_prompt_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"prompt_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"head_receipt_id" uuid,
	"revision_hash" text NOT NULL,
	"request_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_session_id" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"dataset_id" uuid NOT NULL,
	"dataset_hash" text NOT NULL,
	"case_id" uuid NOT NULL,
	"skill_version_id" uuid NOT NULL,
	"config_digest" text NOT NULL,
	"approval_snapshot" jsonb,
	"skill_version_hash" text NOT NULL,
	"secret_value_hash" text NOT NULL,
	"status" text DEFAULT 'awaiting_confirmation' NOT NULL,
	"issue_id" uuid,
	"wakeup_request_id" uuid,
	"heartbeat_run_id" uuid,
	"attempt_id" uuid,
	"prepared" jsonb,
	"spawned_at" timestamp with time zone,
	"private_result" jsonb,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mimouse_private_prompt_test_state" CHECK ("mimouse_private_prompt_tests"."status" IN ('awaiting_confirmation','pending_harness','pending_wake','queued','prepared','spawned','completed','failed','unknown','cancelled')),
	CONSTRAINT "mimouse_private_prompt_test_confirmation" CHECK ("mimouse_private_prompt_tests"."status" <> 'awaiting_confirmation' OR ("mimouse_private_prompt_tests"."issue_id" IS NULL AND "mimouse_private_prompt_tests"."wakeup_request_id" IS NULL AND "mimouse_private_prompt_tests"."heartbeat_run_id" IS NULL AND "mimouse_private_prompt_tests"."attempt_id" IS NULL AND "mimouse_private_prompt_tests"."prepared" IS NULL AND "mimouse_private_prompt_tests"."private_result" IS NULL)),
	CONSTRAINT "mimouse_private_prompt_test_witness" CHECK ("mimouse_private_prompt_tests"."status" NOT IN ('prepared','spawned','completed') OR ("mimouse_private_prompt_tests"."prepared" IS NOT NULL AND "mimouse_private_prompt_tests"."attempt_id" IS NOT NULL AND "mimouse_private_prompt_tests"."heartbeat_run_id" IS NOT NULL)),
	CONSTRAINT "mimouse_private_prompt_test_spawned" CHECK ("mimouse_private_prompt_tests"."status" NOT IN ('spawned','completed') OR "mimouse_private_prompt_tests"."spawned_at" IS NOT NULL),
	CONSTRAINT "mimouse_private_prompt_test_result" CHECK ("mimouse_private_prompt_tests"."status" <> 'completed' OR "mimouse_private_prompt_tests"."private_result" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "mimouse_private_prompt_tests" ADD CONSTRAINT "mimouse_private_prompt_tests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_private_prompt_tests" ADD CONSTRAINT "mimouse_private_prompt_tests_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_private_prompt_tests" ADD CONSTRAINT "mimouse_private_prompt_tests_skill_version_id_company_skill_versions_id_fk" FOREIGN KEY ("skill_version_id") REFERENCES "public"."company_skill_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_private_prompt_tests" ADD CONSTRAINT "mimouse_private_prompt_tests_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_private_prompt_tests" ADD CONSTRAINT "mimouse_private_prompt_tests_wakeup_request_id_agent_wakeup_requests_id_fk" FOREIGN KEY ("wakeup_request_id") REFERENCES "public"."agent_wakeup_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_private_prompt_tests" ADD CONSTRAINT "mimouse_private_prompt_tests_heartbeat_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("heartbeat_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_private_prompt_tests" ADD CONSTRAINT "mimouse_private_prompt_test_revision" FOREIGN KEY ("company_id","prompt_id","revision_id") REFERENCES "public"."mimouse_prompt_revisions"("company_id","prompt_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_private_prompt_tests" ADD CONSTRAINT "mimouse_private_prompt_test_receipt" FOREIGN KEY ("company_id","prompt_id","head_receipt_id") REFERENCES "public"."mimouse_prompt_receipts"("company_id","prompt_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_private_prompt_tests" ADD CONSTRAINT "mimouse_private_prompt_test_dataset" FOREIGN KEY ("company_id","dataset_id") REFERENCES "public"."mimouse_evaluation_datasets"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_private_prompt_test_request" ON "mimouse_private_prompt_tests" USING btree ("company_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_private_prompt_test_issue" ON "mimouse_private_prompt_tests" USING btree ("issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_private_prompt_test_wake" ON "mimouse_private_prompt_tests" USING btree ("wakeup_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_private_prompt_test_run" ON "mimouse_private_prompt_tests" USING btree ("heartbeat_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_private_prompt_test_attempt" ON "mimouse_private_prompt_tests" USING btree ("attempt_id");--> statement-breakpoint
-- paperclip:migration-safety-ignore large-create-index-not-concurrently: The per-file transaction must atomically install the private intent schema and its at-most-once wake fence. This new selective namespace still scans the existing queue; apply with workers/app stopped in a maintenance window. Local lock_timeout=5s and statement_timeout=120s bound lock acquisition and the scan; timeout or duplicate keys rolls back the whole file without deleting history.
CREATE UNIQUE INDEX "agent_wakeup_requests_private_prompt_test_uq" ON "agent_wakeup_requests" USING btree ("company_id","idempotency_key") WHERE "agent_wakeup_requests"."idempotency_key" LIKE 'private-prompt-test:%';