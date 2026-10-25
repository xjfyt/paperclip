CREATE TABLE "mimouse_coding_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"gitlab_origin" text NOT NULL,
	"project_id" integer NOT NULL,
	"secret_ref" uuid NOT NULL,
	"base_sha" text NOT NULL,
	"head_sha" text NOT NULL,
	"source_branch" text NOT NULL,
	"target_branch" text NOT NULL,
	"reviewed_sha" text,
	"reviewer_user_id" text,
	"mr_iid" integer,
	"pipeline_id" integer,
	"operation_state" text DEFAULT 'local' NOT NULL,
	"operation_lease" uuid,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"remote_evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"artifact_manifest" jsonb,
	"repair_attempts" integer DEFAULT 0 NOT NULL,
	"last_failure_fingerprint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mimouse_coding_issue_head_unique" UNIQUE("company_id","issue_id","head_sha")
);
--> statement-breakpoint
ALTER TABLE "mimouse_coding_deliveries" ADD CONSTRAINT "mimouse_coding_deliveries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_coding_deliveries" ADD CONSTRAINT "mimouse_coding_deliveries_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_coding_deliveries" ADD CONSTRAINT "mimouse_coding_deliveries_workspace_id_execution_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."execution_workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_coding_deliveries" ADD CONSTRAINT "mimouse_coding_deliveries_secret_ref_company_secrets_id_fk" FOREIGN KEY ("secret_ref") REFERENCES "public"."company_secrets"("id") ON DELETE no action ON UPDATE no action;