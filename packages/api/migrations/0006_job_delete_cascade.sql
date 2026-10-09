-- The original composite SET NULL action also tried to null tenant_id, which
-- is NOT NULL. Job deletion is intentionally destructive, so these associated
-- delivery events belong to the job cascade.
ALTER TABLE app.webhook_delivery_events
  DROP CONSTRAINT IF EXISTS webhook_delivery_events_tenant_id_job_id_fkey;
ALTER TABLE app.webhook_delivery_events
  ADD CONSTRAINT webhook_delivery_events_tenant_id_job_id_fkey
  FOREIGN KEY (tenant_id,job_id) REFERENCES app.jobs(tenant_id,id) ON DELETE CASCADE;

INSERT INTO app.schema_migrations(version) VALUES ('0006_job_delete_cascade') ON CONFLICT DO NOTHING;
