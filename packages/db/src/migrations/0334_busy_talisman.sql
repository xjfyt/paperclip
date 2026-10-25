CREATE TABLE "mimouse_notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"subscription_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"lease" uuid,
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_code" text,
	"receipt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mimouse_notification_delivery_state" CHECK ("mimouse_notification_deliveries"."state" IN ('pending','claimed','sending','accepted','rejected','retryable','indeterminate','paused'))
);
--> statement-breakpoint
CREATE TABLE "mimouse_notification_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"config" jsonb NOT NULL,
	"secret_ref" uuid NOT NULL,
	"secret_version" integer NOT NULL,
	"target_key" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mimouse_notification_secret_version_positive" CHECK ("mimouse_notification_endpoints"."secret_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "mimouse_notification_rate_limits" (
	"target_key" text PRIMARY KEY NOT NULL,
	"next_allowed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mimouse_notification_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_notification_endpoint_company_identity" ON "mimouse_notification_endpoints" USING btree ("company_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_notification_subscription_company_identity" ON "mimouse_notification_subscriptions" USING btree ("company_id","id");--> statement-breakpoint
ALTER TABLE "mimouse_notification_deliveries" ADD CONSTRAINT "mimouse_notification_deliveries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_notification_deliveries" ADD CONSTRAINT "mimouse_notification_deliveries_company_id_subscription_id_mimouse_notification_subscriptions_company_id_id_fk" FOREIGN KEY ("company_id","subscription_id") REFERENCES "public"."mimouse_notification_subscriptions"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_notification_deliveries" ADD CONSTRAINT "mimouse_notification_deliveries_company_id_endpoint_id_mimouse_notification_endpoints_company_id_id_fk" FOREIGN KEY ("company_id","endpoint_id") REFERENCES "public"."mimouse_notification_endpoints"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_notification_endpoints" ADD CONSTRAINT "mimouse_notification_endpoints_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_notification_endpoints" ADD CONSTRAINT "mimouse_notification_endpoints_secret_ref_company_secrets_id_fk" FOREIGN KEY ("secret_ref") REFERENCES "public"."company_secrets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_notification_subscriptions" ADD CONSTRAINT "mimouse_notification_subscriptions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_notification_subscriptions" ADD CONSTRAINT "mimouse_notification_subscriptions_company_id_endpoint_id_mimouse_notification_endpoints_company_id_id_fk" FOREIGN KEY ("company_id","endpoint_id") REFERENCES "public"."mimouse_notification_endpoints"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_notification_delivery_unique" ON "mimouse_notification_deliveries" USING btree ("company_id","event_id","subscription_id");--> statement-breakpoint
CREATE INDEX "mimouse_notification_delivery_pending" ON "mimouse_notification_deliveries" USING btree ("state","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_notification_subscription_unique" ON "mimouse_notification_subscriptions" USING btree ("company_id","endpoint_id","event_type");