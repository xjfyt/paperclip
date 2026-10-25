CREATE TABLE "mimouse_notification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"secret_ref" uuid NOT NULL,
	"secret_version" integer NOT NULL,
	"kind" text NOT NULL,
	"identity" text NOT NULL,
	"token_material" jsonb,
	"expires_at" timestamp with time zone,
	"revision" integer DEFAULT 0 NOT NULL,
	"lease" uuid,
	"lease_expires_at" timestamp with time zone,
	"next_refresh_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mimouse_notification_token_shape" CHECK ("mimouse_notification_tokens"."secret_version">0 AND "mimouse_notification_tokens"."revision">=0 AND "mimouse_notification_tokens"."kind" IN ('dingtalk_app','wechat_official_account') AND (("mimouse_notification_tokens"."token_material" IS NULL AND "mimouse_notification_tokens"."expires_at" IS NULL) OR ("mimouse_notification_tokens"."token_material" IS NOT NULL AND "mimouse_notification_tokens"."expires_at" IS NOT NULL)))
);
--> statement-breakpoint
ALTER TABLE "mimouse_notification_tokens" ADD CONSTRAINT "mimouse_notification_tokens_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_notification_tokens" ADD CONSTRAINT "mimouse_notification_tokens_secret_ref_company_secrets_id_fk" FOREIGN KEY ("secret_ref") REFERENCES "public"."company_secrets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_notification_token_scope" ON "mimouse_notification_tokens" USING btree ("company_id","secret_ref","secret_version","kind");