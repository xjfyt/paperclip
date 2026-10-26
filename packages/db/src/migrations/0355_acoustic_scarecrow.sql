CREATE TABLE "mimouse_wecom_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"bot_hash" text NOT NULL,
	"config" jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"activation_token" uuid,
	"state" text DEFAULT 'disabled' NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"gap_detected" boolean DEFAULT false NOT NULL,
	"imported" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mimouse_feedback_inbox" DROP CONSTRAINT "mimouse_feedback_shape";--> statement-breakpoint
ALTER TABLE "mimouse_wecom_connections" ADD CONSTRAINT "mimouse_wecom_connections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_wecom_global_bot" ON "mimouse_wecom_connections" USING btree ("bot_hash");--> statement-breakpoint
CREATE INDEX "mimouse_wecom_company" ON "mimouse_wecom_connections" USING btree ("company_id","created_at");--> statement-breakpoint
ALTER TABLE "mimouse_feedback_inbox" ADD CONSTRAINT "mimouse_feedback_shape" CHECK ("mimouse_feedback_inbox"."ingestion_mode" IN ('manual_import','provider_fetch','provider_push') AND "mimouse_feedback_inbox"."status"='candidate' AND "mimouse_feedback_inbox"."redaction_version"=1 AND "mimouse_feedback_inbox"."source_kind" IN ('manual','application_log','langfuse','wecom_smart_bot') AND length("mimouse_feedback_inbox"."title") BETWEEN 1 AND 240 AND length("mimouse_feedback_inbox"."body") BETWEEN 1 AND 32000);