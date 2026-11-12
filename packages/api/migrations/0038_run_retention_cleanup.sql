-- Durable ownership for external objects outlives the run aggregate it cleans.
CREATE TABLE app.run_retention_cleanup (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  run_id uuid NOT NULL,
  object_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  execution_backend_kind text,
  execution_handle jsonb,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX run_retention_cleanup_due ON app.run_retention_cleanup(next_attempt_at, id) WHERE completed_at IS NULL;

-- Candidate scans use the immutable creation timestamp and terminal-state filter.
CREATE INDEX runs_retention_candidates ON app.runs(created_at, tenant_id, invocation_id)
  WHERE state IN ('succeeded','failed','stopped');

-- Cascading deletion and cleanup ownership lookup should not scan these child tables.
CREATE INDEX run_activity_by_run ON app.run_activity(tenant_id, run_id);
CREATE INDEX lifecycle_events_by_source_run ON app.lifecycle_events(tenant_id, source_run_id);
CREATE INDEX lifecycle_deliveries_by_source_run ON app.lifecycle_deliveries(tenant_id, source_run_id);
CREATE INDEX credential_run_enrollments_by_run ON app.credential_run_enrollments(tenant_id, run_id);
CREATE INDEX webhook_delivery_events_by_delivery ON app.webhook_delivery_events(tenant_id, delivery_id);

INSERT INTO app.schema_migrations(version) VALUES ('0038_run_retention_cleanup') ON CONFLICT DO NOTHING;
