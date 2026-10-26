CREATE UNIQUE INDEX "mimouse_feedback_company_identity" ON "mimouse_feedback_inbox" USING btree ("company_id","id");
--> statement-breakpoint
CREATE TABLE "mimouse_feedback_promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"feedback_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"issue_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL,
	"review" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mimouse_feedback_promotions" ADD CONSTRAINT "mimouse_feedback_promotions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_feedback_promotions" ADD CONSTRAINT "mimouse_feedback_promotion_source_fk" FOREIGN KEY ("company_id","feedback_id") REFERENCES "public"."mimouse_feedback_inbox"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_feedback_promotions" ADD CONSTRAINT "mimouse_feedback_promotion_issue_fk" FOREIGN KEY ("company_id","issue_id") REFERENCES "public"."issues"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_feedback_promotion_once" ON "mimouse_feedback_promotions" USING btree ("company_id","feedback_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_feedback_promotion_request" ON "mimouse_feedback_promotions" USING btree ("company_id","request_id");--> statement-breakpoint
