CREATE TABLE "mimouse_research_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"actor_id" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"evidence_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mimouse_research_shape" CHECK (length("mimouse_research_candidates"."request_digest")=64 AND length("mimouse_research_candidates"."evidence_hash")=64)
);
--> statement-breakpoint
CREATE TABLE "mimouse_research_promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"issue_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL,
	"evidence_hash" text NOT NULL,
	"review" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_research_company_identity" ON "mimouse_research_candidates" USING btree ("company_id","id");--> statement-breakpoint
ALTER TABLE "mimouse_research_candidates" ADD CONSTRAINT "mimouse_research_candidates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_research_promotions" ADD CONSTRAINT "mimouse_research_promotions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_research_promotions" ADD CONSTRAINT "mimouse_research_promotion_candidate_fk" FOREIGN KEY ("company_id","candidate_id") REFERENCES "public"."mimouse_research_candidates"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_research_promotions" ADD CONSTRAINT "mimouse_research_promotion_issue_fk" FOREIGN KEY ("company_id","issue_id") REFERENCES "public"."issues"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_research_request" ON "mimouse_research_candidates" USING btree ("company_id","request_id");--> statement-breakpoint
CREATE INDEX "mimouse_research_page" ON "mimouse_research_candidates" USING btree ("company_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_research_promotion_once" ON "mimouse_research_promotions" USING btree ("company_id","candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_research_promotion_request" ON "mimouse_research_promotions" USING btree ("company_id","request_id");