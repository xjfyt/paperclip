CREATE TABLE "mimouse_workbuddy_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"token_secret_ref" uuid,
	"token_version" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_agent_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"oauth_state_hash" text,
	"oauth_session_id" text,
	"oauth_expires_at" timestamp with time zone,
	"oauth_redirect_uri" text,
	"refresh_lease" uuid,
	"last_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mimouse_wb_connection_company_identity" UNIQUE("company_id","id"),
	CONSTRAINT "mimouse_wb_connection_owner" UNIQUE("company_id","owner_user_id"),
	CONSTRAINT "mimouse_wb_oauth_state_unique" UNIQUE("oauth_state_hash")
);
--> statement-breakpoint
CREATE TABLE "mimouse_workbuddy_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"request_key" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"run_id" uuid,
	"provider_job_id" text,
	"dispatch_state" text DEFAULT 'dispatching' NOT NULL,
	"remote_state" text DEFAULT 'unknown' NOT NULL,
	"cancel_state" text DEFAULT 'not_requested' NOT NULL,
	"report" text DEFAULT '' NOT NULL,
	"artifact_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active_turn" uuid,
	"last_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mimouse_wb_job_company_identity" UNIQUE("company_id","id"),
	CONSTRAINT "mimouse_wb_job_request_unique" UNIQUE("company_id","connection_id","request_key")
);
--> statement-breakpoint
CREATE TABLE "mimouse_workbuddy_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"request_key" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"state" text DEFAULT 'prepared' NOT NULL,
	"stop_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mimouse_wb_turn_request_unique" UNIQUE("company_id","job_id","request_key"),
	CONSTRAINT "mimouse_wb_turn_state" CHECK ("mimouse_workbuddy_turns"."state" IN ('prepared','dispatched','round_finished','indeterminate'))
);
--> statement-breakpoint
ALTER TABLE "mimouse_workbuddy_connections" ADD CONSTRAINT "mimouse_workbuddy_connections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_workbuddy_connections" ADD CONSTRAINT "mimouse_workbuddy_connections_token_secret_ref_company_secrets_id_fk" FOREIGN KEY ("token_secret_ref") REFERENCES "public"."company_secrets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_workbuddy_jobs" ADD CONSTRAINT "mimouse_workbuddy_jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_workbuddy_jobs" ADD CONSTRAINT "mimouse_workbuddy_jobs_company_id_connection_id_mimouse_workbuddy_connections_company_id_id_fk" FOREIGN KEY ("company_id","connection_id") REFERENCES "public"."mimouse_workbuddy_connections"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_workbuddy_turns" ADD CONSTRAINT "mimouse_workbuddy_turns_company_id_job_id_mimouse_workbuddy_jobs_company_id_id_fk" FOREIGN KEY ("company_id","job_id") REFERENCES "public"."mimouse_workbuddy_jobs"("company_id","id") ON DELETE no action ON UPDATE no action;