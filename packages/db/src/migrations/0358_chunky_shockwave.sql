-- Atomic additive schema. Stop application/workers and drain writes in a maintenance window.
-- Existing heartbeat/coding/promotion uniqueness scans are bounded per statement, not online DDL.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '120s';
--> statement-breakpoint
CREATE TABLE "mimouse_feedback_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"feedback_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"reproduction_delivery_id" uuid NOT NULL,
	"regression_delivery_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"preview_digest" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mimouse_prompt_application_dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"state" text DEFAULT 'prepared' NOT NULL,
	"configured_at" timestamp with time zone NOT NULL,
	"prepared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"prompt_hash" text,
	"effective_context_hash" text NOT NULL,
	CONSTRAINT "mimouse_prompt_application_dispatch_witness" CHECK ("mimouse_prompt_application_dispatches"."generation" > 0 AND "mimouse_prompt_application_dispatches"."effective_context_hash" ~ '^[a-f0-9]{64}$' AND ("mimouse_prompt_application_dispatches"."prompt_hash" IS NULL OR "mimouse_prompt_application_dispatches"."prompt_hash" ~ '^[a-f0-9]{64}$') AND "mimouse_prompt_application_dispatches"."prepared_at" >= "mimouse_prompt_application_dispatches"."configured_at" AND ("mimouse_prompt_application_dispatches"."dispatched_at" IS NULL OR "mimouse_prompt_application_dispatches"."dispatched_at" >= "mimouse_prompt_application_dispatches"."prepared_at")),
	CONSTRAINT "mimouse_prompt_application_dispatch_state" CHECK ("mimouse_prompt_application_dispatches"."state" IN ('prepared','dispatched') AND ("mimouse_prompt_application_dispatches"."state" <> 'dispatched' OR ("mimouse_prompt_application_dispatches"."prompt_hash" IS NOT NULL AND "mimouse_prompt_application_dispatches"."dispatched_at" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "mimouse_prompt_application_heads" (
	"company_id" uuid NOT NULL,
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"application_id" uuid,
	"configured_at" timestamp with time zone,
	CONSTRAINT "mimouse_prompt_application_head_generation" CHECK ("mimouse_prompt_application_heads"."generation" >= 0 AND (("mimouse_prompt_application_heads"."application_id" IS NULL AND "mimouse_prompt_application_heads"."configured_at" IS NULL) OR ("mimouse_prompt_application_heads"."application_id" IS NOT NULL AND "mimouse_prompt_application_heads"."configured_at" IS NOT NULL AND "mimouse_prompt_application_heads"."generation" > 0)))
);
--> statement-breakpoint
CREATE TABLE "mimouse_prompt_application_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"action" text NOT NULL,
	"generation" integer NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_session_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mimouse_prompt_application_receipt_digest" CHECK ("mimouse_prompt_application_receipts"."request_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "mimouse_prompt_application_receipt_action" CHECK ("mimouse_prompt_application_receipts"."action" IN ('configure','rollback') AND "mimouse_prompt_application_receipts"."generation" > 0)
);
--> statement-breakpoint
CREATE TABLE "mimouse_prompt_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"prompt_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"revision_hash" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_session_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"expected_generation" integer NOT NULL,
	"approval_digest" text NOT NULL,
	"comparison" jsonb NOT NULL,
	"report_hash" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"approval_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mimouse_prompt_application_generation" CHECK ("mimouse_prompt_applications"."expected_generation" >= 0),
	CONSTRAINT "mimouse_prompt_application_hashes" CHECK ("mimouse_prompt_applications"."revision_hash" ~ '^[a-f0-9]{64}$' AND "mimouse_prompt_applications"."request_digest" ~ '^[a-f0-9]{64}$' AND "mimouse_prompt_applications"."approval_digest" ~ '^[a-f0-9]{64}$' AND "mimouse_prompt_applications"."report_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "mimouse_prompt_application_expiry" CHECK ("mimouse_prompt_applications"."approval_expires_at" > "mimouse_prompt_applications"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_feedback_verification_request" ON "mimouse_feedback_verifications" USING btree ("company_id","request_id");
--> statement-breakpoint
CREATE INDEX "mimouse_feedback_verification_history" ON "mimouse_feedback_verifications" USING btree ("company_id","feedback_id","created_at","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_prompt_application_dispatch_run" ON "mimouse_prompt_application_dispatches" USING btree ("run_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_prompt_application_dispatch_issue" ON "mimouse_prompt_application_dispatches" USING btree ("issue_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_prompt_application_receipt_request" ON "mimouse_prompt_application_receipts" USING btree ("company_id","request_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_prompt_application_receipt_generation" ON "mimouse_prompt_application_receipts" USING btree ("company_id","agent_id","generation");
--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_prompt_application_receipt_scope" ON "mimouse_prompt_application_receipts" USING btree ("company_id","agent_id","application_id","generation");
--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_prompt_application_request" ON "mimouse_prompt_applications" USING btree ("company_id","request_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_prompt_application_identity" ON "mimouse_prompt_applications" USING btree ("company_id","agent_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_feedback_promotion_verification_identity" ON "mimouse_feedback_promotions" USING btree ("company_id","feedback_id","issue_id");
--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD CONSTRAINT "heartbeat_runs_prompt_application_scope_uq" UNIQUE("company_id","agent_id","id");
--> statement-breakpoint
ALTER TABLE "mimouse_coding_deliveries" ADD CONSTRAINT "mimouse_coding_verification_identity" UNIQUE("company_id","id","issue_id");
--> statement-breakpoint
ALTER TABLE "mimouse_feedback_verifications" ADD CONSTRAINT "mimouse_feedback_verification_promotion_fk" FOREIGN KEY ("company_id","feedback_id","issue_id") REFERENCES "public"."mimouse_feedback_promotions"("company_id","feedback_id","issue_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mimouse_feedback_verifications" ADD CONSTRAINT "mimouse_feedback_verification_reproduction_fk" FOREIGN KEY ("company_id","reproduction_delivery_id","issue_id") REFERENCES "public"."mimouse_coding_deliveries"("company_id","id","issue_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mimouse_feedback_verifications" ADD CONSTRAINT "mimouse_feedback_verification_regression_fk" FOREIGN KEY ("company_id","regression_delivery_id","issue_id") REFERENCES "public"."mimouse_coding_deliveries"("company_id","id","issue_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mimouse_prompt_application_dispatches" ADD CONSTRAINT "mimouse_prompt_application_dispatch_run_scope" FOREIGN KEY ("company_id","agent_id","run_id") REFERENCES "public"."heartbeat_runs"("company_id","agent_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mimouse_prompt_application_dispatches" ADD CONSTRAINT "mimouse_prompt_application_dispatch_issue_scope" FOREIGN KEY ("company_id","issue_id") REFERENCES "public"."issues"("company_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mimouse_prompt_application_dispatches" ADD CONSTRAINT "mimouse_prompt_application_dispatch_receipt" FOREIGN KEY ("company_id","agent_id","application_id","generation") REFERENCES "public"."mimouse_prompt_application_receipts"("company_id","agent_id","application_id","generation") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mimouse_prompt_application_dispatches" ADD CONSTRAINT "mimouse_prompt_application_dispatches_company_id_agent_id_application_id_mimouse_prompt_applications_company_id_agent_id_id_fk" FOREIGN KEY ("company_id","agent_id","application_id") REFERENCES "public"."mimouse_prompt_applications"("company_id","agent_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mimouse_prompt_application_heads" ADD CONSTRAINT "mimouse_prompt_application_heads_company_id_agent_id_agents_company_id_id_fk" FOREIGN KEY ("company_id","agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mimouse_prompt_application_heads" ADD CONSTRAINT "mimouse_prompt_application_heads_company_id_agent_id_application_id_mimouse_prompt_applications_company_id_agent_id_id_fk" FOREIGN KEY ("company_id","agent_id","application_id") REFERENCES "public"."mimouse_prompt_applications"("company_id","agent_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mimouse_prompt_application_heads" ADD CONSTRAINT "mimouse_prompt_application_head_receipt" FOREIGN KEY ("company_id","agent_id","application_id","generation") REFERENCES "public"."mimouse_prompt_application_receipts"("company_id","agent_id","application_id","generation") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mimouse_prompt_application_receipts" ADD CONSTRAINT "mimouse_prompt_application_receipts_company_id_agent_id_application_id_mimouse_prompt_applications_company_id_agent_id_id_fk" FOREIGN KEY ("company_id","agent_id","application_id") REFERENCES "public"."mimouse_prompt_applications"("company_id","agent_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mimouse_prompt_applications" ADD CONSTRAINT "mimouse_prompt_applications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mimouse_prompt_applications" ADD CONSTRAINT "mimouse_prompt_applications_company_id_agent_id_agents_company_id_id_fk" FOREIGN KEY ("company_id","agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mimouse_prompt_applications" ADD CONSTRAINT "mimouse_prompt_applications_company_id_prompt_id_revision_id_mimouse_prompt_revisions_company_id_prompt_id_id_fk" FOREIGN KEY ("company_id","prompt_id","revision_id") REFERENCES "public"."mimouse_prompt_revisions"("company_id","prompt_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- These records are append-only evidence, not mutable current-state rows.
CREATE FUNCTION mimouse_review_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'review_history_immutable' USING ERRCODE = '23514'; END;
$$;
--> statement-breakpoint
CREATE TRIGGER mimouse_feedback_verifications_immutable BEFORE UPDATE OR DELETE ON mimouse_feedback_verifications
FOR EACH ROW EXECUTE FUNCTION mimouse_review_history_immutable();
--> statement-breakpoint
CREATE TRIGGER mimouse_prompt_applications_immutable BEFORE UPDATE OR DELETE ON mimouse_prompt_applications
FOR EACH ROW EXECUTE FUNCTION mimouse_review_history_immutable();
--> statement-breakpoint
CREATE TRIGGER mimouse_prompt_application_receipts_immutable BEFORE UPDATE OR DELETE ON mimouse_prompt_application_receipts
FOR EACH ROW EXECUTE FUNCTION mimouse_review_history_immutable();
