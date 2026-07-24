BEGIN;
CREATE TABLE IF NOT EXISTS runtime_ai_results(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  actor_subject text NOT NULL,
  prompt_sha256 text NOT NULL CHECK (length(prompt_sha256) = 64),
  model text NOT NULL,
  provider_receipt text NOT NULL,
  result text NOT NULL,
  usage jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,actor_subject) REFERENCES actors(tenant_id,subject)
);
CREATE INDEX IF NOT EXISTS runtime_ai_results_tenant_time_idx ON runtime_ai_results(tenant_id,created_at DESC);
COMMIT;
