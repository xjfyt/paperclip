CREATE TABLE "mimouse_notification_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"evidence" text NOT NULL,
	"actor_id" text NOT NULL,
	"observed_state" text NOT NULL,
	"observed_attempt" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mimouse_notification_review_shape" CHECK ("mimouse_notification_reviews"."outcome" IN ('accepted','not_accepted','unknown') AND "mimouse_notification_reviews"."observed_attempt">=0 AND "mimouse_notification_reviews"."observed_state" IN ('accepted','rejected','indeterminate'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_notification_delivery_company_identity" ON "mimouse_notification_deliveries" USING btree ("company_id","id");
--> statement-breakpoint
ALTER TABLE "mimouse_notification_reviews" ADD CONSTRAINT "mimouse_notification_reviews_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mimouse_notification_reviews" ADD CONSTRAINT "mimouse_notification_reviews_company_id_delivery_id_mimouse_notification_deliveries_company_id_id_fk" FOREIGN KEY ("company_id","delivery_id") REFERENCES "public"."mimouse_notification_deliveries"("company_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_notification_review_request" ON "mimouse_notification_reviews" USING btree ("company_id","delivery_id","request_id");
