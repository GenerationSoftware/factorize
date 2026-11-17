-- Immutable, token-free owner/scope snapshots for vendor-authenticated runs.
-- Kept independently of browser sessions and legacy run bearer credentials.
CREATE TABLE app.run_authorizations (
  tenant_id uuid NOT NULL,
  run_id uuid NOT NULL,
  user_id uuid NOT NULL,
  session_version integer NOT NULL,
  scopes jsonb NOT NULL CHECK (jsonb_typeof(scopes)='array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,run_id),
  FOREIGN KEY (tenant_id,run_id) REFERENCES app.job_runs(tenant_id,id) ON DELETE CASCADE
);
-- Deliberately retain the original user/session binding if membership is
-- deleted: a replacement owner cannot recreate authority for an old run.
INSERT INTO app.schema_migrations(version) VALUES ('0050_run_authorizations') ON CONFLICT DO NOTHING;
