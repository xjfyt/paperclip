CREATE TABLE "mimouse_langfuse_pulls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"config_digest" text NOT NULL,
	"actor_id" text NOT NULL,
	"config" jsonb NOT NULL,
	"cursor" text,
	"cursor_digests" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"pages" integer DEFAULT 0 NOT NULL,
	"imported" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mimouse_feedback_inbox" DROP CONSTRAINT "mimouse_feedback_shape";--> statement-breakpoint
ALTER TABLE "mimouse_feedback_inbox" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "mimouse_langfuse_pulls" ADD CONSTRAINT "mimouse_langfuse_pulls_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_langfuse_pulls_request" ON "mimouse_langfuse_pulls" USING btree ("company_id","request_id");--> statement-breakpoint
CREATE INDEX "mimouse_langfuse_pulls_company" ON "mimouse_langfuse_pulls" USING btree ("company_id","created_at");--> statement-breakpoint
ALTER TABLE "mimouse_feedback_inbox" ADD CONSTRAINT "mimouse_feedback_shape" CHECK ("mimouse_feedback_inbox"."ingestion_mode" IN ('manual_import','provider_fetch') AND "mimouse_feedback_inbox"."status"='candidate' AND "mimouse_feedback_inbox"."redaction_version"=1 AND "mimouse_feedback_inbox"."source_kind" IN ('manual','application_log','langfuse','wecom_smart_bot') AND length("mimouse_feedback_inbox"."title") BETWEEN 1 AND 240 AND length("mimouse_feedback_inbox"."body") BETWEEN 1 AND 32000);