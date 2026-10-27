-- Atomic additive schema. Drain application/worker writes in a maintenance window.
-- The existing wake-request uniqueness scan is bounded, not online DDL.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '120s';
--> statement-breakpoint
CREATE TABLE "runtime_routing_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"selected_agent_id" uuid NOT NULL,
	"selected_candidate_snapshot" jsonb NOT NULL,
	"request_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_session_id" text NOT NULL,
	"decision_digest" text NOT NULL,
	"task_digest" text NOT NULL,
	"state" text DEFAULT 'bound' NOT NULL,
	"dispatch_request_id" uuid,
	"dispatch_request_digest" text,
	"dispatch_actor_user_id" text,
	"dispatch_actor_session_id" text,
	"wake_requested_at" timestamp with time zone,
	"run_id" uuid,
	"start_requested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_routing_binding_hashes" CHECK ("runtime_routing_bindings"."request_digest" ~ '^[a-f0-9]{64}$' AND "runtime_routing_bindings"."decision_digest" ~ '^[a-f0-9]{64}$' AND "runtime_routing_bindings"."task_digest" ~ '^[a-f0-9]{64}$' AND ("runtime_routing_bindings"."dispatch_request_digest" IS NULL OR "runtime_routing_bindings"."dispatch_request_digest" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "runtime_routing_binding_generation" CHECK ("runtime_routing_bindings"."generation" > 0),
	CONSTRAINT "runtime_routing_binding_dispatch_shape" CHECK (("runtime_routing_bindings"."dispatch_request_id" IS NULL AND "runtime_routing_bindings"."dispatch_request_digest" IS NULL AND "runtime_routing_bindings"."dispatch_actor_user_id" IS NULL AND "runtime_routing_bindings"."dispatch_actor_session_id" IS NULL AND "runtime_routing_bindings"."wake_requested_at" IS NULL) OR ("runtime_routing_bindings"."dispatch_request_id" IS NOT NULL AND "runtime_routing_bindings"."dispatch_request_digest" IS NOT NULL AND "runtime_routing_bindings"."dispatch_actor_user_id" IS NOT NULL AND "runtime_routing_bindings"."dispatch_actor_session_id" IS NOT NULL AND "runtime_routing_bindings"."wake_requested_at" IS NOT NULL)),
	CONSTRAINT "runtime_routing_binding_state" CHECK (("runtime_routing_bindings"."state" = 'bound' AND "runtime_routing_bindings"."dispatch_request_id" IS NULL AND "runtime_routing_bindings"."run_id" IS NULL AND "runtime_routing_bindings"."start_requested_at" IS NULL) OR ("runtime_routing_bindings"."state" = 'wake_pending' AND "runtime_routing_bindings"."dispatch_request_id" IS NOT NULL AND "runtime_routing_bindings"."run_id" IS NULL AND "runtime_routing_bindings"."start_requested_at" IS NULL) OR ("runtime_routing_bindings"."state" = 'run_claimed' AND "runtime_routing_bindings"."dispatch_request_id" IS NOT NULL AND "runtime_routing_bindings"."run_id" IS NOT NULL AND "runtime_routing_bindings"."start_requested_at" IS NULL) OR ("runtime_routing_bindings"."state" = 'start_requested' AND "runtime_routing_bindings"."dispatch_request_id" IS NOT NULL AND "runtime_routing_bindings"."run_id" IS NOT NULL AND "runtime_routing_bindings"."start_requested_at" IS NOT NULL)),
	CONSTRAINT "runtime_routing_binding_chronology" CHECK (("runtime_routing_bindings"."wake_requested_at" IS NULL OR "runtime_routing_bindings"."wake_requested_at" >= "runtime_routing_bindings"."created_at") AND ("runtime_routing_bindings"."start_requested_at" IS NULL OR "runtime_routing_bindings"."start_requested_at" >= "runtime_routing_bindings"."wake_requested_at"))
);
--> statement-breakpoint
CREATE TABLE "runtime_routing_heads" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"policy_id" uuid,
	"configured_at" timestamp with time zone,
	CONSTRAINT "runtime_routing_head_state" CHECK ("runtime_routing_heads"."generation" >= 0 AND (("runtime_routing_heads"."policy_id" IS NULL AND "runtime_routing_heads"."configured_at" IS NULL) OR ("runtime_routing_heads"."policy_id" IS NOT NULL AND "runtime_routing_heads"."configured_at" IS NOT NULL AND "runtime_routing_heads"."generation" > 0)))
);
--> statement-breakpoint
CREATE TABLE "runtime_routing_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_session_id" text NOT NULL,
	"expected_generation" integer NOT NULL,
	"policy" jsonb NOT NULL,
	"candidates" jsonb NOT NULL,
	"approval_digest" text NOT NULL,
	"approval_expires_at" timestamp with time zone NOT NULL,
	"approval_closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_routing_policy_generation" CHECK ("runtime_routing_policies"."expected_generation" >= 0 AND "runtime_routing_policies"."expected_generation" < 2147483647),
	CONSTRAINT "runtime_routing_policy_hashes" CHECK ("runtime_routing_policies"."request_digest" ~ '^[a-f0-9]{64}$' AND "runtime_routing_policies"."approval_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "runtime_routing_policy_expiry" CHECK ("runtime_routing_policies"."approval_expires_at" > "runtime_routing_policies"."created_at"),
	CONSTRAINT "runtime_routing_policy_closure" CHECK ("runtime_routing_policies"."approval_closed_at" IS NULL OR "runtime_routing_policies"."approval_closed_at" >= "runtime_routing_policies"."approval_expires_at"),
	CONSTRAINT "runtime_routing_policy_pool" CHECK (jsonb_typeof("runtime_routing_policies"."candidates") = 'array' AND jsonb_array_length("runtime_routing_policies"."candidates") BETWEEN 1 AND 20)
);
--> statement-breakpoint
CREATE TABLE "runtime_routing_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_session_id" text NOT NULL,
	"action" text NOT NULL,
	"generation" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_routing_receipt_action" CHECK ("runtime_routing_receipts"."action" IN ('approve','disable') AND "runtime_routing_receipts"."generation" > 0),
	CONSTRAINT "runtime_routing_receipt_digest" CHECK ("runtime_routing_receipts"."request_digest" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
-- Composite FK targets must be unique before PostgreSQL installs the FKs.
CREATE UNIQUE INDEX "runtime_routing_binding_scope" ON "runtime_routing_bindings" USING btree ("company_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_routing_binding_request" ON "runtime_routing_bindings" USING btree ("company_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_routing_binding_dispatch" ON "runtime_routing_bindings" USING btree ("company_id","dispatch_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_routing_binding_issue" ON "runtime_routing_bindings" USING btree ("issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_routing_binding_run" ON "runtime_routing_bindings" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_routing_policy_scope" ON "runtime_routing_policies" USING btree ("company_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_routing_policy_request" ON "runtime_routing_policies" USING btree ("company_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_routing_receipt_request" ON "runtime_routing_receipts" USING btree ("company_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_routing_receipt_generation" ON "runtime_routing_receipts" USING btree ("company_id","generation");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_routing_receipt_scope" ON "runtime_routing_receipts" USING btree ("company_id","policy_id","generation");--> statement-breakpoint
-- paperclip:migration-safety-ignore large-create-index-not-concurrently: The per-file transaction must atomically install routing state and its terminal-inclusive at-most-once wake fence; CONCURRENTLY is incompatible with that transaction. This selective namespace still scans the existing queue: stop application/workers and drain writes in a maintenance window. Local lock_timeout=5s and statement_timeout=120s bound lock acquisition and the scan; timeout or duplicate keys rolls back the whole file without deleting history.
CREATE UNIQUE INDEX "agent_wakeup_requests_runtime_cost_routing_uq" ON "agent_wakeup_requests" USING btree ("company_id","idempotency_key") WHERE "agent_wakeup_requests"."idempotency_key" LIKE 'runtime-cost-routing:%';
--> statement-breakpoint
ALTER TABLE "runtime_routing_bindings" ADD CONSTRAINT "runtime_routing_binding_issue_fk" FOREIGN KEY ("company_id","issue_id") REFERENCES "public"."issues"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_routing_bindings" ADD CONSTRAINT "runtime_routing_binding_agent_fk" FOREIGN KEY ("company_id","selected_agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_routing_bindings" ADD CONSTRAINT "runtime_routing_binding_receipt_fk" FOREIGN KEY ("company_id","policy_id","generation") REFERENCES "public"."runtime_routing_receipts"("company_id","policy_id","generation") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_routing_bindings" ADD CONSTRAINT "runtime_routing_binding_run_fk" FOREIGN KEY ("company_id","selected_agent_id","run_id") REFERENCES "public"."heartbeat_runs"("company_id","agent_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_routing_heads" ADD CONSTRAINT "runtime_routing_heads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_routing_heads" ADD CONSTRAINT "runtime_routing_head_receipt_fk" FOREIGN KEY ("company_id","policy_id","generation") REFERENCES "public"."runtime_routing_receipts"("company_id","policy_id","generation") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_routing_policies" ADD CONSTRAINT "runtime_routing_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_routing_receipts" ADD CONSTRAINT "runtime_routing_receipt_policy_fk" FOREIGN KEY ("company_id","policy_id") REFERENCES "public"."runtime_routing_policies"("company_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- Keep proposal evidence immutable except for the explicit, monotone expiry
-- tombstone. DELETE is deliberately not trapped: authorized company deletion
-- removes bindings, heads, receipts, then policies in its existing transaction.
CREATE FUNCTION runtime_routing_policy_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'approval_closed_at') IS DISTINCT FROM (to_jsonb(OLD) - 'approval_closed_at')
    OR OLD.approval_closed_at IS NOT NULL
    OR NEW.approval_closed_at IS NULL
    OR NEW.approval_closed_at < OLD.approval_expires_at
    OR NEW.approval_closed_at > clock_timestamp()
    OR OLD.approval_expires_at > clock_timestamp()
    OR EXISTS (SELECT 1 FROM public.runtime_routing_receipts
      WHERE company_id = OLD.company_id AND policy_id = OLD.id AND action = 'approve')
    OR EXISTS (SELECT 1 FROM public.runtime_routing_heads
      WHERE company_id = OLD.company_id AND policy_id = OLD.id)
  THEN
    RAISE EXCEPTION 'runtime_routing_policy_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER runtime_routing_policies_update_guard BEFORE UPDATE ON runtime_routing_policies
FOR EACH ROW EXECUTE FUNCTION runtime_routing_policy_update_guard();
--> statement-breakpoint
CREATE FUNCTION runtime_routing_receipt_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'runtime_routing_receipt_immutable' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER runtime_routing_receipts_update_guard BEFORE UPDATE ON runtime_routing_receipts
FOR EACH ROW EXECUTE FUNCTION runtime_routing_receipt_update_guard();
--> statement-breakpoint
-- The service locks head -> policy for approve and close. Also serialize any
-- approve receipt INSERT with a policy UPDATE at the database boundary: an FK's
-- KEY SHARE lock alone would not conflict with the non-key closure UPDATE.
-- Never acquire a head lock here (that would reverse the service lock order).
CREATE FUNCTION runtime_routing_approve_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  proposal public.runtime_routing_policies%ROWTYPE;
BEGIN
  IF NEW.action = 'approve' THEN
    SELECT * INTO proposal FROM public.runtime_routing_policies
      WHERE company_id = NEW.company_id AND id = NEW.policy_id FOR UPDATE;
    IF NOT FOUND OR proposal.approval_closed_at IS NOT NULL
      OR proposal.approval_expires_at <= clock_timestamp()
    THEN
      RAISE EXCEPTION 'runtime_routing_approval_changed_or_expired' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER runtime_routing_receipts_approve_guard BEFORE INSERT ON runtime_routing_receipts
FOR EACH ROW EXECUTE FUNCTION runtime_routing_approve_insert_guard();
