CREATE TABLE "mimouse_coding_repair_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"pipeline_id" integer NOT NULL,
	"head_sha" text NOT NULL,
	"fingerprint" text NOT NULL,
	"routine_id" uuid NOT NULL,
	"routine_revision_id" uuid NOT NULL,
	"request_key" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"state" text DEFAULT 'reserved' NOT NULL,
	"lease" uuid,
	"lease_expires_at" timestamp with time zone,
	"routine_run_id" uuid,
	"issue_id" uuid,
	"last_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mimouse_repair_attempt_unique" UNIQUE("delivery_id","attempt"),
	CONSTRAINT "mimouse_repair_pipeline_unique" UNIQUE("delivery_id","pipeline_id"),
	CONSTRAINT "mimouse_repair_request_unique" UNIQUE("company_id","request_key")
);
--> statement-breakpoint
ALTER TABLE "mimouse_coding_deliveries" ADD COLUMN "repair_policy" jsonb;--> statement-breakpoint
ALTER TABLE "mimouse_coding_deliveries" ADD COLUMN "repair_status" text DEFAULT 'disabled' NOT NULL;--> statement-breakpoint
ALTER TABLE "mimouse_coding_deliveries" ADD COLUMN "repair_last_code" text;--> statement-breakpoint
ALTER TABLE "mimouse_coding_deliveries" ADD CONSTRAINT "mimouse_coding_company_id_unique" UNIQUE("company_id","id");--> statement-breakpoint
ALTER TABLE "mimouse_coding_repair_attempts" ADD CONSTRAINT "mimouse_coding_repair_attempts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_coding_repair_attempts" ADD CONSTRAINT "mimouse_coding_repair_attempts_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_coding_repair_attempts" ADD CONSTRAINT "mimouse_coding_repair_attempts_routine_revision_id_routine_revisions_id_fk" FOREIGN KEY ("routine_revision_id") REFERENCES "public"."routine_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_coding_repair_attempts" ADD CONSTRAINT "mimouse_coding_repair_attempts_routine_run_id_routine_runs_id_fk" FOREIGN KEY ("routine_run_id") REFERENCES "public"."routine_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_coding_repair_attempts" ADD CONSTRAINT "mimouse_coding_repair_attempts_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_coding_repair_attempts" ADD CONSTRAINT "mimouse_repair_delivery_company_fk" FOREIGN KEY ("company_id","delivery_id") REFERENCES "public"."mimouse_coding_deliveries"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mimouse_repair_pending_idx" ON "mimouse_coding_repair_attempts" USING btree ("state","created_at");