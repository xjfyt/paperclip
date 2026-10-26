-- Integration staging SQL: assign the next migration number in the integrator.
-- Append-only policy versions and receipts. No mutation/dispatch tables touched.
CREATE TABLE cost_routing_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id),
  revision integer NOT NULL CONSTRAINT cost_routing_policy_positive_revision CHECK (revision > 0), request_id uuid NOT NULL, request_hash text NOT NULL,
  policy jsonb NOT NULL, actor_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cost_routing_policy_revision UNIQUE (company_id, revision),
  CONSTRAINT cost_routing_policy_request UNIQUE (company_id, request_id)
);
CREATE TABLE cost_routing_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id),
  policy_revision integer NOT NULL, request_id uuid NOT NULL, request_hash text NOT NULL,
  preview jsonb NOT NULL, receipt_hash text NOT NULL, actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cost_routing_preview_request UNIQUE (company_id, request_id),
  FOREIGN KEY (company_id, policy_revision) REFERENCES cost_routing_policies(company_id, revision)
);
CREATE FUNCTION deny_cost_routing_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Cost routing preview history is append-only'; END;
$$;
CREATE TRIGGER cost_routing_policy_immutable BEFORE UPDATE OR DELETE ON cost_routing_policies
  FOR EACH ROW EXECUTE FUNCTION deny_cost_routing_history_mutation();
CREATE TRIGGER cost_routing_preview_immutable BEFORE UPDATE OR DELETE ON cost_routing_previews
  FOR EACH ROW EXECUTE FUNCTION deny_cost_routing_history_mutation();
