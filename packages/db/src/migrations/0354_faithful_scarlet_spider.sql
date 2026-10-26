CREATE TABLE "cost_routing_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"policy" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_routing_policy_positive_revision" CHECK ("cost_routing_policies"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "cost_routing_previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"policy_revision" integer NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"preview" jsonb NOT NULL,
	"receipt_hash" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cost_routing_policy_revision" ON "cost_routing_policies" USING btree ("company_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_routing_policy_request" ON "cost_routing_policies" USING btree ("company_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_routing_preview_request" ON "cost_routing_previews" USING btree ("company_id","request_id");--> statement-breakpoint
ALTER TABLE "cost_routing_policies" ADD CONSTRAINT "cost_routing_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_routing_previews" ADD CONSTRAINT "cost_routing_previews_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_routing_previews" ADD CONSTRAINT "cost_routing_previews_company_id_policy_revision_cost_routing_policies_company_id_revision_fk" FOREIGN KEY ("company_id","policy_revision") REFERENCES "public"."cost_routing_policies"("company_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION deny_cost_routing_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Cost routing preview history is append-only'; END;
$$;
--> statement-breakpoint
CREATE TRIGGER cost_routing_policy_immutable BEFORE UPDATE OR DELETE ON cost_routing_policies
FOR EACH ROW EXECUTE FUNCTION deny_cost_routing_history_mutation();
--> statement-breakpoint
CREATE TRIGGER cost_routing_preview_immutable BEFORE UPDATE OR DELETE ON cost_routing_previews
FOR EACH ROW EXECUTE FUNCTION deny_cost_routing_history_mutation();
