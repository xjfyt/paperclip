CREATE TABLE "mimouse_research_routine_bindings" (
	"company_id" uuid NOT NULL,
	"routine_id" uuid NOT NULL,
	"product" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"configured_by_user_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mimouse_research_routine_bindings_company_id_routine_id_pk" PRIMARY KEY("company_id","routine_id")
);
--> statement-breakpoint
CREATE TABLE "mimouse_evaluation_restores" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"action" text NOT NULL,
	"rollback_of" uuid,
	"status" text DEFAULT 'prepared' NOT NULL,
	"resolution" text DEFAULT 'apply' NOT NULL,
	"before_version_id" uuid NOT NULL,
	"target_version_id" uuid NOT NULL,
	"before_hash" text NOT NULL,
	"target_hash" text NOT NULL,
	"operation_hash" text NOT NULL,
	"before_name" text NOT NULL,
	"before_description" text,
	"target_name" text NOT NULL,
	"target_description" text,
	"source_directory" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"completed_by_user_id" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "mimouse_eval_restore_shape" CHECK ("mimouse_evaluation_restores"."status" in ('prepared','applied','compensated') and "mimouse_evaluation_restores"."resolution" in ('apply','compensate') and "mimouse_evaluation_restores"."action" in ('activate','rollback') and length("mimouse_evaluation_restores"."operation_hash")=64 and length("mimouse_evaluation_restores"."before_hash")=64 and length("mimouse_evaluation_restores"."target_hash")=64 and (("mimouse_evaluation_restores"."status"='prepared' and "mimouse_evaluation_restores"."completed_at" is null) or ("mimouse_evaluation_restores"."status"<>'prepared' and "mimouse_evaluation_restores"."completed_at" is not null)))
);
--> statement-breakpoint
ALTER TABLE "mimouse_research_routine_bindings" ADD CONSTRAINT "mimouse_research_routine_bindings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_research_routine_bindings" ADD CONSTRAINT "mimouse_research_routine_bindings_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_evaluation_restores" ADD CONSTRAINT "mimouse_evaluation_restores_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_evaluation_restores" ADD CONSTRAINT "mimouse_evaluation_restores_skill_id_company_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."company_skills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_evaluation_restores" ADD CONSTRAINT "mimouse_evaluation_restores_report_id_mimouse_evaluation_comparisons_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."mimouse_evaluation_comparisons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_evaluation_restores" ADD CONSTRAINT "mimouse_evaluation_restores_before_version_id_company_skill_versions_id_fk" FOREIGN KEY ("before_version_id") REFERENCES "public"."company_skill_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_evaluation_restores" ADD CONSTRAINT "mimouse_evaluation_restores_target_version_id_company_skill_versions_id_fk" FOREIGN KEY ("target_version_id") REFERENCES "public"."company_skill_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_eval_restore_request" ON "mimouse_evaluation_restores" USING btree ("company_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_eval_restore_pending" ON "mimouse_evaluation_restores" USING btree ("company_id","skill_id") WHERE "mimouse_evaluation_restores"."status" = 'prepared';--> statement-breakpoint
CREATE INDEX "mimouse_eval_restore_list" ON "mimouse_evaluation_restores" USING btree ("company_id","id");