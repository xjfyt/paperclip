-- A0 migration proposal: assign the real migration number/journal centrally.
-- Additive only. No provider/secret resolution and no dispatch side effects.
-- FULL REFERENCE, not an append-only supplement to Drizzle output.
-- DRIZZLE-OWNED: the column and check below, and the final index, are already
-- declared in mimouse_notifications.ts. Keep each generated DDL exactly once.
ALTER TABLE mimouse_notification_endpoints ADD COLUMN verification_epoch integer NOT NULL DEFAULT 1;
ALTER TABLE mimouse_notification_endpoints ADD CONSTRAINT mimouse_notification_verification_epoch_positive CHECK (verification_epoch > 0);

-- CUSTOM SUPPLEMENT BEGIN: Drizzle does not generate these four functions
-- and four triggers. Append this section after the generated column/check;
-- separate complete top-level statements with migration statement-breakpoints.
-- Security mutations take their own source row first, then endpoint rows.
-- Evidence append must lock provider config -> secret -> version -> endpoint,
-- NEVER endpoint -> secret. Its company-ledger lock precedes all these locks.
-- All explicit evidence locks are FOR NO KEY UPDATE: serialize metadata
-- mutations while allowing existing revision/rotation FK KEY SHARE checks.
CREATE FUNCTION mimouse_notification_secret_epoch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.status, OLD.scope, OLD.owner_user_id, OLD.provider, OLD.managed_mode, OLD.external_ref, OLD.provider_config_id, OLD.deleted_at)
     IS DISTINCT FROM ROW(NEW.status, NEW.scope, NEW.owner_user_id, NEW.provider, NEW.managed_mode, NEW.external_ref, NEW.provider_config_id, NEW.deleted_at) THEN
    UPDATE mimouse_notification_endpoints SET verification_epoch = verification_epoch + 1
      WHERE company_id = OLD.company_id AND secret_ref = OLD.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mimouse_notification_secret_epoch AFTER UPDATE ON company_secrets
  FOR EACH ROW EXECUTE FUNCTION mimouse_notification_secret_epoch();

CREATE FUNCTION mimouse_notification_version_epoch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE mimouse_notification_endpoints SET verification_epoch = verification_epoch + 1
      WHERE secret_ref = OLD.secret_id AND secret_version = OLD.version;
    RETURN OLD;
  END IF;
  IF ROW(OLD.status IN ('disabled','destroyed'), OLD.revoked_at, OLD.provider_version_ref, OLD.value_sha256, OLD.fingerprint_sha256, OLD.material)
     IS DISTINCT FROM ROW(NEW.status IN ('disabled','destroyed'), NEW.revoked_at, NEW.provider_version_ref, NEW.value_sha256, NEW.fingerprint_sha256, NEW.material) THEN
    UPDATE mimouse_notification_endpoints SET verification_epoch = verification_epoch + 1
      WHERE secret_ref = OLD.secret_id AND secret_version = OLD.version;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mimouse_notification_version_epoch AFTER UPDATE OR DELETE ON company_secret_versions
  FOR EACH ROW EXECUTE FUNCTION mimouse_notification_version_epoch();

CREATE FUNCTION mimouse_notification_provider_epoch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior company_secret_provider_configs; current_row company_secret_provider_configs; security_changed boolean;
BEGIN
  IF TG_OP <> 'INSERT' THEN prior := OLD; END IF;
  IF TG_OP <> 'DELETE' THEN current_row := NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    security_changed := ROW(OLD.provider, OLD.status, OLD.config, OLD.disabled_at) IS DISTINCT FROM ROW(NEW.provider, NEW.status, NEW.config, NEW.disabled_at);
  ELSE security_changed := true; END IF;
  IF TG_OP = 'UPDATE' AND NOT security_changed AND OLD.is_default IS NOT DISTINCT FROM NEW.is_default THEN RETURN NEW; END IF;
  UPDATE mimouse_notification_endpoints e SET verification_epoch = verification_epoch + 1
    FROM company_secrets s WHERE e.company_id = s.company_id AND e.secret_ref = s.id AND s.provider <> 'local_encrypted' AND (
      (s.company_id = prior.company_id AND ((security_changed AND s.provider_config_id = prior.id)
        OR (prior.is_default AND s.provider_config_id IS NULL AND s.provider = prior.provider))) OR
      (s.company_id = current_row.company_id AND ((security_changed AND s.provider_config_id = current_row.id)
        OR (current_row.is_default AND s.provider_config_id IS NULL AND s.provider = current_row.provider)))
    );
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER mimouse_notification_provider_epoch AFTER INSERT OR UPDATE OR DELETE ON company_secret_provider_configs
  FOR EACH ROW EXECUTE FUNCTION mimouse_notification_provider_epoch();

-- Freeze at creation, including the existing SQL run.failed producer. Never
-- backfill old rows or restamp a manual replay into a newer credential epoch.
CREATE FUNCTION mimouse_notification_freeze_epoch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e mimouse_notification_endpoints;
BEGIN
  IF NEW.snapshot ? 'verificationEpoch' OR NEW.event_id LIKE 'manual-retry:%' THEN RETURN NEW; END IF;
  SELECT * INTO e FROM mimouse_notification_endpoints WHERE id = NEW.endpoint_id AND company_id = NEW.company_id;
  IF FOUND AND NEW.snapshot->>'configVersion' = e.config_version::text
    AND NEW.snapshot->>'secretRef' = e.secret_ref::text AND NEW.snapshot->>'secretVersion' = e.secret_version::text
    AND NEW.snapshot->>'kind' = e.kind THEN
    NEW.snapshot := NEW.snapshot || jsonb_build_object('verificationEpoch', e.verification_epoch);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mimouse_notification_freeze_epoch BEFORE INSERT ON mimouse_notification_deliveries
  FOR EACH ROW EXECUTE FUNCTION mimouse_notification_freeze_epoch();
-- CUSTOM SUPPLEMENT END
-- DRIZZLE-OWNED: do not append a duplicate if the generated migration has it.
CREATE INDEX mimouse_notification_verification_latest ON mimouse_notification_deliveries
  (company_id, endpoint_id, (snapshot->>'configVersion'), created_at DESC, id DESC);
