BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS actors (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  subject text NOT NULL,
  role text NOT NULL CHECK (role IN ('administrator','clinician','coordinator','researcher','caregiver')),
  email text,
  licensed_clinician boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, subject)
);

-- Optional local/test credentials. The application never enables this path in
-- production; keeping the verifier in PostgreSQL still exercises a real
-- persisted identity instead of a source-level demo password.
CREATE TABLE IF NOT EXISTS local_auth_accounts (
  tenant_id uuid NOT NULL,
  subject text NOT NULL,
  email text NOT NULL UNIQUE,
  password_digest text NOT NULL CHECK (password_digest LIKE 'scrypt$%'),
  role text NOT NULL CHECK (role IN ('administrator','clinician','coordinator','researcher','caregiver')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, subject),
  FOREIGN KEY (tenant_id, subject) REFERENCES actors(tenant_id, subject)
);

CREATE TABLE IF NOT EXISTS patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source_system text NOT NULL,
  source_patient_id text NOT NULL,
  identity_digest text NOT NULL,
  encrypted_profile text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_system, source_patient_id),
  UNIQUE (tenant_id, identity_digest)
);

CREATE TABLE IF NOT EXISTS caregiver_assignments (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  caregiver_subject text NOT NULL,
  patient_id uuid NOT NULL REFERENCES patients(id),
  valid_until timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, caregiver_subject, patient_id),
  FOREIGN KEY (tenant_id, caregiver_subject) REFERENCES actors(tenant_id, subject)
);

CREATE TABLE IF NOT EXISTS consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  purpose text NOT NULL CHECK (purpose IN ('care-operations','research-registry','trial-outreach','remote-monitoring')),
  source text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
  valid_until timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  revoked_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_consent_per_purpose
  ON consents(tenant_id, patient_id, purpose) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS clinical_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  patient_id uuid REFERENCES patients(id),
  record_type text NOT NULL,
  encrypted_payload text NOT NULL,
  source_system text NOT NULL,
  source_resource_id text,
  source_version text,
  source_updated_at timestamptz,
  correction_of uuid REFERENCES clinical_records(id),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS clinical_source_resource_once
  ON clinical_records(tenant_id, source_system, source_resource_id, source_version)
  WHERE source_resource_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS document_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  encrypted_metadata text NOT NULL,
  object_key text NOT NULL,
  content_sha256 text NOT NULL CHECK (length(content_sha256) = 64),
  retention_until timestamptz NOT NULL,
  legal_hold boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending-upload' CHECK (status IN ('pending-upload','stored','quarantined','deleted')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, object_key)
);

CREATE TABLE IF NOT EXISTS provider_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  patient_id uuid REFERENCES patients(id),
  provider text NOT NULL,
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  encrypted_request text NOT NULL,
  encrypted_response text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','retryable','dead-letter')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, idempotency_key)
);

CREATE TABLE IF NOT EXISTS callback_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  provider text NOT NULL,
  delivery_id text NOT NULL,
  body_sha256 text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, delivery_id)
);

CREATE TABLE IF NOT EXISTS ai_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  intended_use text NOT NULL,
  model text NOT NULL,
  model_version text NOT NULL,
  prompt_sha256 text NOT NULL,
  encrypted_output text NOT NULL,
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'array' AND jsonb_array_length(evidence) > 0),
  uncertainty text NOT NULL CHECK (uncertainty IN ('low','medium','high')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected')),
  created_by text NOT NULL,
  decided_by text,
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CHECK (decided_by IS NULL OR decided_by <> created_by)
);

CREATE TABLE IF NOT EXISTS model_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  model text NOT NULL,
  model_version text NOT NULL,
  intended_use text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','retired')),
  created_by text NOT NULL,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, model, model_version),
  CHECK (approved_by IS NULL OR approved_by <> created_by)
);

CREATE TABLE IF NOT EXISTS ai_evaluation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  model_release_id uuid NOT NULL REFERENCES model_releases(id),
  evaluation_set_sha256 text NOT NULL CHECK (length(evaluation_set_sha256) = 64),
  metrics jsonb NOT NULL,
  thresholds jsonb NOT NULL,
  passed boolean NOT NULL,
  evidence_uri text NOT NULL,
  evaluated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS export_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  actor_subject text NOT NULL,
  purpose text NOT NULL,
  scope jsonb NOT NULL,
  identified boolean NOT NULL,
  row_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS restore_drills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  backup_reference text NOT NULL,
  status text NOT NULL CHECK (status IN ('scheduled','passed','failed')),
  evidence_uri text,
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  severity text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  summary text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','contained','resolved')),
  recorded_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  actor_subject text NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  purpose text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_immutable ON audit_events;
CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

CREATE INDEX IF NOT EXISTS patients_tenant_idx ON patients(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS consents_lookup_idx ON consents(tenant_id, patient_id, purpose, status, valid_until);
CREATE INDEX IF NOT EXISTS clinical_records_patient_idx ON clinical_records(tenant_id, patient_id, record_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS provider_jobs_due_idx ON provider_jobs(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS audit_tenant_time_idx ON audit_events(tenant_id, occurred_at DESC);

COMMIT;
