CREATE TABLE "mimouse_prompt_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"prompt_id" uuid NOT NULL,
	"action" text NOT NULL,
	"previous_receipt_id" uuid,
	"before_revision_id" uuid,
	"selected_revision_id" uuid,
	"rollback_of_receipt_id" uuid,
	"request_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mimouse_prompt_transition" CHECK ("mimouse_prompt_receipts"."before_revision_id" IS DISTINCT FROM "mimouse_prompt_receipts"."selected_revision_id"),
	CONSTRAINT "mimouse_prompt_action" CHECK (("mimouse_prompt_receipts"."action" = 'promote' AND "mimouse_prompt_receipts"."selected_revision_id" IS NOT NULL AND "mimouse_prompt_receipts"."rollback_of_receipt_id" IS NULL) OR ("mimouse_prompt_receipts"."action" = 'rollback' AND "mimouse_prompt_receipts"."rollback_of_receipt_id" IS NOT NULL AND "mimouse_prompt_receipts"."previous_receipt_id" IS NOT NULL AND "mimouse_prompt_receipts"."rollback_of_receipt_id" = "mimouse_prompt_receipts"."previous_receipt_id"))
);
--> statement-breakpoint
CREATE TABLE "mimouse_prompt_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"prompt_id" uuid NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"request_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mimouse_prompt_content_size" CHECK (octet_length("mimouse_prompt_revisions"."content") BETWEEN 1 AND 128000),
	CONSTRAINT "mimouse_prompt_content_hash" CHECK ("mimouse_prompt_revisions"."content_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "mimouse_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"prompt_key" text NOT NULL,
	"selected_revision_id" uuid,
	"head_receipt_id" uuid,
	CONSTRAINT "mimouse_prompt_key_format" CHECK ("mimouse_prompts"."prompt_key" ~ '^[a-z][a-z0-9_-]{0,79}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_prompt_receipt_request" ON "mimouse_prompt_receipts" USING btree ("company_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_prompt_receipt_identity" ON "mimouse_prompt_receipts" USING btree ("company_id","prompt_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_prompt_revision_request" ON "mimouse_prompt_revisions" USING btree ("company_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_prompt_revision_identity" ON "mimouse_prompt_revisions" USING btree ("company_id","prompt_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_prompt_key" ON "mimouse_prompts" USING btree ("company_id","prompt_key");--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_prompt_identity" ON "mimouse_prompts" USING btree ("company_id","id");
--> statement-breakpoint
ALTER TABLE "mimouse_prompt_receipts" ADD CONSTRAINT "mimouse_prompt_receipts_previous_receipt_id_mimouse_prompt_receipts_id_fk" FOREIGN KEY ("previous_receipt_id") REFERENCES "public"."mimouse_prompt_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_prompt_receipts" ADD CONSTRAINT "mimouse_prompt_receipts_rollback_of_receipt_id_mimouse_prompt_receipts_id_fk" FOREIGN KEY ("rollback_of_receipt_id") REFERENCES "public"."mimouse_prompt_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_prompt_receipts" ADD CONSTRAINT "mimouse_prompt_previous_scope" FOREIGN KEY ("company_id","prompt_id","previous_receipt_id") REFERENCES "public"."mimouse_prompt_receipts"("company_id","prompt_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_prompt_receipts" ADD CONSTRAINT "mimouse_prompt_rollback_scope" FOREIGN KEY ("company_id","prompt_id","rollback_of_receipt_id") REFERENCES "public"."mimouse_prompt_receipts"("company_id","prompt_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_prompt_receipts" ADD CONSTRAINT "mimouse_prompt_receipts_company_id_prompt_id_mimouse_prompts_company_id_id_fk" FOREIGN KEY ("company_id","prompt_id") REFERENCES "public"."mimouse_prompts"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_prompt_receipts" ADD CONSTRAINT "mimouse_prompt_receipts_company_id_prompt_id_before_revision_id_mimouse_prompt_revisions_company_id_prompt_id_id_fk" FOREIGN KEY ("company_id","prompt_id","before_revision_id") REFERENCES "public"."mimouse_prompt_revisions"("company_id","prompt_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_prompt_receipts" ADD CONSTRAINT "mimouse_prompt_receipts_company_id_prompt_id_selected_revision_id_mimouse_prompt_revisions_company_id_prompt_id_id_fk" FOREIGN KEY ("company_id","prompt_id","selected_revision_id") REFERENCES "public"."mimouse_prompt_revisions"("company_id","prompt_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_prompt_revisions" ADD CONSTRAINT "mimouse_prompt_revisions_company_id_prompt_id_mimouse_prompts_company_id_id_fk" FOREIGN KEY ("company_id","prompt_id") REFERENCES "public"."mimouse_prompts"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_prompts" ADD CONSTRAINT "mimouse_prompts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_prompts" ADD CONSTRAINT "mimouse_prompt_selected_scope" FOREIGN KEY ("company_id","id","selected_revision_id") REFERENCES "public"."mimouse_prompt_revisions"("company_id","prompt_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_prompts" ADD CONSTRAINT "mimouse_prompt_head_scope" FOREIGN KEY ("company_id","id","head_receipt_id") REFERENCES "public"."mimouse_prompt_receipts"("company_id","prompt_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION mimouse_prompt_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'prompt_history_immutable' USING ERRCODE = '23514'; END;
$$;
--> statement-breakpoint
CREATE TRIGGER mimouse_prompt_revisions_immutable BEFORE UPDATE OR DELETE ON mimouse_prompt_revisions
FOR EACH ROW EXECUTE FUNCTION mimouse_prompt_history_immutable();
--> statement-breakpoint
CREATE TRIGGER mimouse_prompt_receipts_immutable BEFORE UPDATE OR DELETE ON mimouse_prompt_receipts
FOR EACH ROW EXECUTE FUNCTION mimouse_prompt_history_immutable();
