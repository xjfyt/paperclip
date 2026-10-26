CREATE TABLE "capability_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"action" text NOT NULL,
	"target_id" uuid,
	"receipt" jsonb,
	"reason" text NOT NULL,
	"reviewer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capability_evidence_revision_positive" CHECK ("capability_evidence"."revision" > 0),
	CONSTRAINT "capability_evidence_action_valid" CHECK ("capability_evidence"."action" in ('record','revoke','supersede')),
	CONSTRAINT "capability_evidence_event_shape" CHECK (("capability_evidence"."action" = 'record' and "capability_evidence"."receipt" is not null and "capability_evidence"."target_id" is null) or ("capability_evidence"."action" = 'supersede' and "capability_evidence"."receipt" is not null and "capability_evidence"."target_id" is not null) or ("capability_evidence"."action" = 'revoke' and "capability_evidence"."receipt" is null and "capability_evidence"."target_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "capability_evidence" ADD CONSTRAINT "capability_evidence_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_evidence" ADD CONSTRAINT "capability_evidence_target_id_capability_evidence_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."capability_evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "capability_evidence_company_revision" ON "capability_evidence" USING btree ("company_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "capability_evidence_company_idempotency" ON "capability_evidence" USING btree ("company_id","idempotency_key");
--> statement-breakpoint
CREATE FUNCTION prevent_capability_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Capability evidence is append-only'; END;
$$;
--> statement-breakpoint
CREATE TRIGGER capability_evidence_immutable BEFORE UPDATE OR DELETE ON capability_evidence
FOR EACH ROW EXECUTE FUNCTION prevent_capability_evidence_mutation();
