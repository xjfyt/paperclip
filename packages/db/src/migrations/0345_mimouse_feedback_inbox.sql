CREATE TABLE "mimouse_feedback_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_instance" text NOT NULL,
	"external_id" text NOT NULL,
	"ingestion_mode" text DEFAULT 'manual_import' NOT NULL,
	"content_digest" text NOT NULL,
	"candidate_key" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"product" text NOT NULL,
	"software_version" text NOT NULL,
	"commit_sha" text,
	"trace_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" text NOT NULL,
	"redacted" boolean NOT NULL,
	"redaction_version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'candidate' NOT NULL,
	CONSTRAINT "mimouse_feedback_shape" CHECK ("mimouse_feedback_inbox"."ingestion_mode"='manual_import' AND "mimouse_feedback_inbox"."status"='candidate' AND "mimouse_feedback_inbox"."redaction_version"=1 AND "mimouse_feedback_inbox"."source_kind" IN ('manual','application_log','langfuse','wecom_smart_bot') AND length("mimouse_feedback_inbox"."title") BETWEEN 1 AND 240 AND length("mimouse_feedback_inbox"."body") BETWEEN 1 AND 32000)
);
--> statement-breakpoint
ALTER TABLE "mimouse_feedback_inbox" ADD CONSTRAINT "mimouse_feedback_inbox_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_feedback_source_event" ON "mimouse_feedback_inbox" USING btree ("company_id","source_kind","source_instance","external_id");--> statement-breakpoint
CREATE INDEX "mimouse_feedback_page" ON "mimouse_feedback_inbox" USING btree ("company_id","created_at","id");--> statement-breakpoint
CREATE INDEX "mimouse_feedback_candidates" ON "mimouse_feedback_inbox" USING btree ("company_id","candidate_key","created_at");