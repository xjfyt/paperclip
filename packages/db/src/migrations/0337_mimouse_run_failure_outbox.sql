-- Capture all persisted legacy/native failed outcomes in their owning transaction.
-- This writes only the existing durable outbox; it starts no worker or network request.
-- Opt-in is the active subscription + endpoint. Disabling the runtime worker stops
-- dispatch; disable the subscription as well to stop collecting failed-run events.
CREATE FUNCTION public.mimouse_enqueue_failed_run() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  END IF;
  INSERT INTO public.mimouse_notification_deliveries
    (company_id, event_id, subscription_id, endpoint_id, snapshot)
  SELECT NEW.company_id, 'run.failed:' || NEW.id::text, s.id, e.id,
    e.config || jsonb_build_object(
      'kind', e.kind, 'secretRef', e.secret_ref, 'secretVersion', e.secret_version,
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
--> statement-breakpoint
CREATE TRIGGER mimouse_failed_run_outbox
AFTER INSERT OR UPDATE OF status ON public.heartbeat_runs
FOR EACH ROW WHEN (NEW.status IN ('failed', 'timed_out'))
EXECUTE FUNCTION public.mimouse_enqueue_failed_run();
