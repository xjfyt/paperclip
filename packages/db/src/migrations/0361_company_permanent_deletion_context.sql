-- No data rewrite. Existing immutable UPDATE behavior and triggers stay intact.
-- This is internal transaction context, not authorization or protection from a
-- database owner. The API must still authorize explicit permanent deletion.
CREATE FUNCTION public.paperclip_company_delete_matches(target_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT current_setting('paperclip.company_delete_id', true) = target_company_id::text
    AND current_setting('paperclip.company_delete_xid', true) = txid_current()::text;
$$;
--> statement-breakpoint
CREATE FUNCTION public.paperclip_company_delete_complete()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id = OLD.company_id) THEN
    RAISE EXCEPTION 'company_deletion_incomplete' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.prevent_capability_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND public.paperclip_company_delete_matches(OLD.company_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Capability evidence is append-only';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mimouse_prompt_history_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND public.paperclip_company_delete_matches(OLD.company_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'prompt_history_immutable' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.deny_cost_routing_history_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND public.paperclip_company_delete_matches(OLD.company_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Cost routing preview history is append-only';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mimouse_review_history_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND public.paperclip_company_delete_matches(OLD.company_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'review_history_immutable' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
-- Successful exceptional deletion must include the company in the same
-- transaction. SET CONSTRAINTS ... IMMEDIATE checks earlier and can reject an
-- unfinished purge; callers must not flush these constraints before completion.
CREATE CONSTRAINT TRIGGER capability_evidence_company_delete_complete
AFTER DELETE ON public.capability_evidence DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.paperclip_company_delete_complete();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER mimouse_prompt_revisions_company_delete_complete
AFTER DELETE ON public.mimouse_prompt_revisions DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.paperclip_company_delete_complete();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER mimouse_prompt_receipts_company_delete_complete
AFTER DELETE ON public.mimouse_prompt_receipts DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.paperclip_company_delete_complete();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER cost_routing_policies_company_delete_complete
AFTER DELETE ON public.cost_routing_policies DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.paperclip_company_delete_complete();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER cost_routing_previews_company_delete_complete
AFTER DELETE ON public.cost_routing_previews DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.paperclip_company_delete_complete();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER mimouse_feedback_verifications_company_delete_complete
AFTER DELETE ON public.mimouse_feedback_verifications DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.paperclip_company_delete_complete();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER mimouse_prompt_applications_company_delete_complete
AFTER DELETE ON public.mimouse_prompt_applications DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.paperclip_company_delete_complete();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER mimouse_prompt_application_receipts_company_delete_complete
AFTER DELETE ON public.mimouse_prompt_application_receipts DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.paperclip_company_delete_complete();
