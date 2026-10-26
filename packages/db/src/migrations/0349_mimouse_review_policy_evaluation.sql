CREATE TABLE "mimouse_evaluation_comparisons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"dataset_id" uuid NOT NULL,
	"baseline_version_id" uuid NOT NULL,
	"candidate_version_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"report" jsonb NOT NULL,
	"evidence_snapshot" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mimouse_evaluation_datasets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"name" text NOT NULL,
	"cases" jsonb NOT NULL,
	"dataset_hash" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_eval_dataset_identity" ON "mimouse_evaluation_datasets" USING btree ("company_id","id");--> statement-breakpoint
ALTER TABLE "mimouse_notification_deliveries" DROP CONSTRAINT "mimouse_notification_delivery_state";--> statement-breakpoint
ALTER TABLE "mimouse_coding_deliveries" ADD COLUMN "review_receipt" jsonb;--> statement-breakpoint
ALTER TABLE "mimouse_notification_deliveries" ADD COLUMN "merge_key" text;--> statement-breakpoint
ALTER TABLE "mimouse_notification_deliveries" ADD COLUMN "merge_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mimouse_notification_deliveries" ADD COLUMN "merged_into" uuid;--> statement-breakpoint
ALTER TABLE "mimouse_notification_subscriptions" ADD COLUMN "policy_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "mimouse_notification_subscriptions" ADD COLUMN "policy" jsonb DEFAULT '{"minimumSeverity":"info","mergeWindowSeconds":0}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "mimouse_evaluation_comparisons" ADD CONSTRAINT "mimouse_evaluation_comparisons_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_evaluation_comparisons" ADD CONSTRAINT "mimouse_evaluation_comparisons_baseline_version_id_company_skill_versions_id_fk" FOREIGN KEY ("baseline_version_id") REFERENCES "public"."company_skill_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_evaluation_comparisons" ADD CONSTRAINT "mimouse_evaluation_comparisons_candidate_version_id_company_skill_versions_id_fk" FOREIGN KEY ("candidate_version_id") REFERENCES "public"."company_skill_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_evaluation_comparisons" ADD CONSTRAINT "mimouse_evaluation_comparisons_company_id_dataset_id_mimouse_evaluation_datasets_company_id_id_fk" FOREIGN KEY ("company_id","dataset_id") REFERENCES "public"."mimouse_evaluation_datasets"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_evaluation_datasets" ADD CONSTRAINT "mimouse_evaluation_datasets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_evaluation_datasets" ADD CONSTRAINT "mimouse_evaluation_datasets_skill_id_company_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."company_skills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_eval_comparison_request" ON "mimouse_evaluation_comparisons" USING btree ("company_id","request_id");--> statement-breakpoint
CREATE INDEX "mimouse_eval_comparison_list" ON "mimouse_evaluation_comparisons" USING btree ("company_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_eval_dataset_request" ON "mimouse_evaluation_datasets" USING btree ("company_id","request_id");--> statement-breakpoint
CREATE INDEX "mimouse_eval_dataset_list" ON "mimouse_evaluation_datasets" USING btree ("company_id","id");--> statement-breakpoint
ALTER TABLE "mimouse_notification_deliveries" ADD CONSTRAINT "mimouse_notification_deliveries_company_id_merged_into_mimouse_notification_deliveries_company_id_id_fk" FOREIGN KEY ("company_id","merged_into") REFERENCES "public"."mimouse_notification_deliveries"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mimouse_notification_delivery_merge_window" ON "mimouse_notification_deliveries" USING btree ("company_id","merge_key","merge_until");--> statement-breakpoint
ALTER TABLE "mimouse_notification_deliveries" ADD CONSTRAINT "mimouse_notification_delivery_merge_shape" CHECK (("mimouse_notification_deliveries"."merged_into" IS NULL OR ("mimouse_notification_deliveries"."state"='merged' AND "mimouse_notification_deliveries"."merged_into"<>"mimouse_notification_deliveries"."id")) AND ("mimouse_notification_deliveries"."state"<>'merged' OR "mimouse_notification_deliveries"."merged_into" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "mimouse_notification_deliveries" ADD CONSTRAINT "mimouse_notification_delivery_state" CHECK ("mimouse_notification_deliveries"."state" IN ('pending','claimed','sending','accepted','rejected','retryable','indeterminate','paused','filtered','merged'));--> statement-breakpoint
ALTER TABLE "mimouse_notification_subscriptions" ADD CONSTRAINT "mimouse_notification_policy_version_positive" CHECK ("mimouse_notification_subscriptions"."policy_version">0);
--> statement-breakpoint
-- Freeze the same severity/policy contract used by application producers.
-- Failed runs have distinct run IDs; never collapse unrelated failures.
CREATE OR REPLACE FUNCTION public.mimouse_enqueue_failed_run() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  END IF;
  INSERT INTO public.mimouse_notification_deliveries
    (company_id, event_id, subscription_id, endpoint_id, snapshot, state, last_code)
  SELECT NEW.company_id, 'run.failed:' || NEW.id::text, s.id, e.id,
    e.config || jsonb_build_object(
      'configVersion', e.config_version, 'kind', e.kind, 'secretRef', e.secret_ref, 'secretVersion', e.secret_version,
      'targetKey', e.target_key, 'locale', s.locale, 'renderVersion', 3,
      'renderEvent', 'run.failed', 'renderResourceId', NEW.id::text,
      'renderCompanyPrefix', c.issue_prefix, 'rendered', false,
      'policy', p.policy, 'policyVersion', s.policy_version, 'severity', 'warning',
      'policyEvent', 'run.failed', 'policyResourceId', NEW.id::text,
      'title', 'Agent run failed', 'text', NEW.id::text
    ),
    CASE WHEN p.policy->>'minimumSeverity'='critical' THEN 'filtered' ELSE 'pending' END,
    CASE WHEN p.policy->>'minimumSeverity'='critical' THEN 'severity_filtered' ELSE NULL END
  FROM public.mimouse_notification_subscriptions s
  JOIN public.mimouse_notification_endpoints e ON e.id = s.endpoint_id AND e.company_id = s.company_id
  JOIN public.companies c ON c.id = s.company_id
  CROSS JOIN LATERAL (
    SELECT CASE WHEN jsonb_typeof(s.policy)='object'
      AND s.policy ?& ARRAY['minimumSeverity','mergeWindowSeconds']
      AND (s.policy - ARRAY['minimumSeverity','mergeWindowSeconds'])='{}'::jsonb
      AND s.policy->>'minimumSeverity' IN ('info','warning','critical')
      AND jsonb_typeof(s.policy->'mergeWindowSeconds')='number'
      THEN CASE WHEN (s.policy->>'mergeWindowSeconds')::numeric BETWEEN 0 AND 300
        AND trunc((s.policy->>'mergeWindowSeconds')::numeric)=(s.policy->>'mergeWindowSeconds')::numeric
        THEN s.policy ELSE '{"minimumSeverity":"info","mergeWindowSeconds":0}'::jsonb END
      ELSE '{"minimumSeverity":"info","mergeWindowSeconds":0}'::jsonb END AS policy
  ) p
  WHERE s.company_id = NEW.company_id AND s.event_type = 'run.failed' AND s.enabled AND e.enabled
  ON CONFLICT (company_id, event_id, subscription_id) DO NOTHING;
  RETURN NEW;
END;
$$;
