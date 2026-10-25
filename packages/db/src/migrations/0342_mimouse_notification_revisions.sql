CREATE TABLE "mimouse_notification_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"config_version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mimouse_notification_revision_positive" CHECK ("mimouse_notification_revisions"."config_version">0)
);
--> statement-breakpoint
ALTER TABLE "mimouse_notification_endpoints" ADD COLUMN "config_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "mimouse_notification_revisions" ADD CONSTRAINT "mimouse_notification_revisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mimouse_notification_revisions" ADD CONSTRAINT "mimouse_notification_revisions_company_id_endpoint_id_mimouse_notification_endpoints_company_id_id_fk" FOREIGN KEY ("company_id","endpoint_id") REFERENCES "public"."mimouse_notification_endpoints"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mimouse_notification_revision_version" ON "mimouse_notification_revisions" USING btree ("company_id","endpoint_id","config_version");
--> statement-breakpoint
-- Preserve existing configurations before any operator edits; no secret values are copied.
INSERT INTO public.mimouse_notification_revisions (company_id, endpoint_id, config_version, snapshot, actor_id)
SELECT company_id, id, config_version,
  jsonb_build_object('name', name, 'kind', kind, 'config', config, 'secretRef', secret_ref, 'secretVersion', secret_version, 'configVersion', config_version),
  'system:migration-backfill'
FROM public.mimouse_notification_endpoints
ON CONFLICT (company_id, endpoint_id, config_version) DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mimouse_enqueue_failed_run() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  END IF;
  INSERT INTO public.mimouse_notification_deliveries
    (company_id, event_id, subscription_id, endpoint_id, snapshot)
  SELECT NEW.company_id, 'run.failed:' || NEW.id::text, s.id, e.id,
    e.config || jsonb_build_object(
      'configVersion', e.config_version, 'kind', e.kind, 'secretRef', e.secret_ref, 'secretVersion', e.secret_version,
      'targetKey', e.target_key, 'locale', s.locale, 'renderVersion', 3,
      'renderEvent', 'run.failed', 'renderResourceId', NEW.id::text,
      'renderCompanyPrefix', c.issue_prefix, 'rendered', false,
      'title', 'Agent run failed', 'text', NEW.id::text
    )
  FROM public.mimouse_notification_subscriptions s
  JOIN public.mimouse_notification_endpoints e ON e.id = s.endpoint_id AND e.company_id = s.company_id
  JOIN public.companies c ON c.id = s.company_id
  WHERE s.company_id = NEW.company_id AND s.event_type = 'run.failed' AND s.enabled AND e.enabled
  ON CONFLICT (company_id, event_id, subscription_id) DO NOTHING;
  RETURN NEW;
END;
$$;
