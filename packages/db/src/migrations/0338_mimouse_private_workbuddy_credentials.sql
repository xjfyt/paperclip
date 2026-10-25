ALTER TABLE "mimouse_workbuddy_connections" ADD COLUMN "token_material" jsonb;--> statement-breakpoint
ALTER TABLE "mimouse_workbuddy_connections" ADD COLUMN "credential_identity" text;--> statement-breakpoint
ALTER TABLE "mimouse_workbuddy_jobs" ADD COLUMN "credential_identity" text;--> statement-breakpoint
-- Earlier prototype OAuth values were company-scoped. Revoke that generic
-- binding surface, retain the encrypted historical versions, and require a
-- new owner-authorized callback. Never copy these tokens into another Agent.
UPDATE company_secrets AS s SET status = 'disabled', updated_at = now()
FROM mimouse_workbuddy_connections AS c
WHERE s.id = c.token_secret_ref AND s.company_id = c.company_id AND s.scope = 'company';
--> statement-breakpoint
UPDATE mimouse_workbuddy_connections SET status = 'reauthorization_required',
  last_code = 'credential_scope_migration_required', allowed_agent_ids = '[]'::jsonb
WHERE token_secret_ref IS NOT NULL;
