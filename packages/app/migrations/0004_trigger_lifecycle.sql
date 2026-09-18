-- Disabled triggers remain editable. Removed triggers disappear from the job
-- definition but retain their stable identity while history references them.
ALTER TABLE app.triggers ADD COLUMN IF NOT EXISTS removed_at timestamptz;

ALTER TABLE app.triggers DROP CONSTRAINT IF EXISTS triggers_tenant_id_job_id_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS triggers_active_slug
  ON app.triggers (tenant_id,job_id,slug) WHERE removed_at IS NULL;

INSERT INTO app.schema_migrations(version) VALUES ('0004_trigger_lifecycle') ON CONFLICT DO NOTHING;
