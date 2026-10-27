-- Additive, bounded DDL. Observation receipts never authorize delivery admission.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
CREATE TABLE "mimouse_coding_build_observation_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "delivery_id" uuid NOT NULL,
  "request_id" uuid NOT NULL,
  "actor_user_id" text NOT NULL,
  "actor_session_id" text NOT NULL,
  "request_digest" text NOT NULL,
  "snapshot_digest" text NOT NULL,
  "profile_id" text NOT NULL,
  "job_id" bigint NOT NULL,
  "state" text DEFAULT 'running' NOT NULL,
  "attempt_count" integer DEFAULT 1 NOT NULL,
  "lease_token" uuid,
  "lease_expires_at" timestamp with time zone,
  "retry_until" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "mimouse_build_observation_request_hashes" CHECK ("request_digest" ~ '^[a-f0-9]{64}$' AND "snapshot_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "mimouse_build_observation_request_identity" CHECK ("job_id" BETWEEN 1 AND 9007199254740991 AND "profile_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$'),
  CONSTRAINT "mimouse_build_observation_request_state" CHECK (("state" = 'running' AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL) OR ("state" = 'terminal' AND "lease_token" IS NULL AND "lease_expires_at" IS NULL)),
  CONSTRAINT "mimouse_build_observation_request_bounds" CHECK ("attempt_count" BETWEEN 1 AND 2 AND "retry_until" > "created_at" AND ("lease_expires_at" IS NULL OR "lease_expires_at" <= "retry_until"))
);
--> statement-breakpoint
CREATE TABLE "mimouse_coding_build_observation_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "delivery_id" uuid NOT NULL,
  "request_id" uuid NOT NULL,
  "status" text NOT NULL,
  "diagnostic" text NOT NULL,
  "admission" text DEFAULT 'blocked' NOT NULL,
  "result" jsonb NOT NULL,
  "snapshot_digest" text NOT NULL,
  "observed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "mimouse_build_observation_receipt_state" CHECK ("status" IN ('observed','blocked') AND "admission" = 'blocked'),
  CONSTRAINT "mimouse_build_observation_receipt_hashes" CHECK ("snapshot_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "mimouse_build_observation_receipt_projection" CHECK (jsonb_typeof("result") = 'object' AND ("result"->>'admission') IS NOT DISTINCT FROM 'blocked' AND octet_length("result"::text) <= 16384 AND "diagnostic" ~ '^[a-z][a-z0-9_]{0,99}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_build_observation_request_unique" ON "mimouse_coding_build_observation_requests" USING btree ("company_id", "request_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_build_observation_request_scope" ON "mimouse_coding_build_observation_requests" USING btree ("company_id", "delivery_id", "request_id");
--> statement-breakpoint
CREATE INDEX "mimouse_build_observation_request_quota" ON "mimouse_coding_build_observation_requests" USING btree ("company_id", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_build_observation_receipt_unique" ON "mimouse_coding_build_observation_receipts" USING btree ("company_id", "request_id");
--> statement-breakpoint
CREATE INDEX "mimouse_build_observation_receipt_history" ON "mimouse_coding_build_observation_receipts" USING btree ("company_id", "delivery_id", "created_at", "id");
--> statement-breakpoint
ALTER TABLE "mimouse_coding_build_observation_requests" ADD CONSTRAINT "mimouse_coding_build_observation_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mimouse_coding_build_observation_requests" ADD CONSTRAINT "mimouse_build_observation_request_delivery_fk" FOREIGN KEY ("company_id", "delivery_id") REFERENCES "public"."mimouse_coding_deliveries"("company_id", "id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mimouse_coding_build_observation_receipts" ADD CONSTRAINT "mimouse_build_observation_receipt_request_fk" FOREIGN KEY ("company_id", "delivery_id", "request_id") REFERENCES "public"."mimouse_coding_build_observation_requests"("company_id", "delivery_id", "request_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- DELETE is deliberately not trapped: authorized company/delivery cleanup can cascade.
-- There is no observation API for deleting receipts or rewriting their build timestamps.
CREATE FUNCTION mimouse_build_observation_receipt_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'mimouse_build_observation_receipt_immutable' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER mimouse_build_observation_receipts_update_guard
BEFORE UPDATE ON mimouse_coding_build_observation_receipts
FOR EACH ROW EXECUTE FUNCTION mimouse_build_observation_receipt_update_guard();
