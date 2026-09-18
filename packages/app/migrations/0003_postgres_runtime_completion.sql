-- Runtime completion after the initial PostgreSQL cutover.
ALTER TABLE app.pending_verifications ADD COLUMN IF NOT EXISTS trigger_id uuid;
DELETE FROM app.pending_verifications WHERE trigger_id IS NULL;
ALTER TABLE app.pending_verifications ALTER COLUMN job_id SET NOT NULL;
ALTER TABLE app.pending_verifications ALTER COLUMN trigger_id SET NOT NULL;
ALTER TABLE app.pending_verifications DROP CONSTRAINT IF EXISTS pending_verifications_trigger_id_fkey;
ALTER TABLE app.pending_verifications ADD CONSTRAINT pending_verifications_trigger_id_fkey FOREIGN KEY (tenant_id,trigger_id) REFERENCES app.triggers(tenant_id,id) ON DELETE CASCADE;

INSERT INTO app.schema_migrations(version) VALUES ('0003_postgres_runtime_completion') ON CONFLICT DO NOTHING;
