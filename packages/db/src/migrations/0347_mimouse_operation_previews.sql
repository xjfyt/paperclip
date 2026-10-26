CREATE TABLE "mimouse_operation_previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"input_snapshot" jsonb NOT NULL,
	"preview" jsonb NOT NULL,
	"preview_hash" text NOT NULL,
	"actor_id" text NOT NULL,
	"approval_id" uuid,
	"approval_payload_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mimouse_operation_preview_shape" CHECK (length("mimouse_operation_previews"."preview_hash")=64 AND length("mimouse_operation_previews"."request_digest")=64 AND (("mimouse_operation_previews"."approval_id" IS NULL AND "mimouse_operation_previews"."approval_payload_hash" IS NULL) OR ("mimouse_operation_previews"."approval_id" IS NOT NULL AND "mimouse_operation_previews"."approval_payload_hash" IS NOT NULL AND length("mimouse_operation_previews"."approval_payload_hash")=64)))
);
--> statement-breakpoint
ALTER TABLE "mimouse_operation_previews" ADD CONSTRAINT "mimouse_operation_previews_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_operation_previews" ADD CONSTRAINT "mimouse_operation_previews_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_operation_preview_request" ON "mimouse_operation_previews" USING btree ("company_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_operation_preview_company_identity" ON "mimouse_operation_previews" USING btree ("company_id","id");--> statement-breakpoint
CREATE INDEX "mimouse_operation_preview_list" ON "mimouse_operation_previews" USING btree ("company_id","created_at");