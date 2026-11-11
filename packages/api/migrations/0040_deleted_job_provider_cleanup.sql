-- Provider ownership must survive the job/run cascades in explicit job deletion.
CREATE TABLE app.deleted_job_provider_cleanup (
  tenant_id uuid NOT NULL,
  run_id uuid NOT NULL,
  execution_config jsonb NOT NULL,
  execution_backend_kind text NOT NULL,
  execution_handle jsonb,
  started_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, run_id)
);
CREATE INDEX deleted_job_provider_cleanup_due
  ON app.deleted_job_provider_cleanup(next_attempt_at, tenant_id, run_id);

INSERT INTO app.schema_migrations(version) VALUES ('0040_deleted_job_provider_cleanup') ON CONFLICT DO NOTHING;
