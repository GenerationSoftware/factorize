-- Breaking cutover: dispatch must remain paused through preparation/deploy.
-- Fresh installs have no data to prepare. Existing installations must run the
-- reviewed prepare-credential-cutover script after draining ALL old runs.
LOCK TABLE app.job_runs, app.integration_records IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM app.job_runs WHERE state NOT IN ('succeeded','failed','stopped')) THEN
    RAISE EXCEPTION 'GEN-2922 cutover requires drained terminal runs';
  END IF;
  IF EXISTS (SELECT 1 FROM app.integration_records) AND NOT EXISTS (
    SELECT 1 FROM app.schema_migrations WHERE version='gen_2922_credentials_prepared'
  ) THEN
    RAISE EXCEPTION 'Run prepare-credential-cutover before the GEN-2922 migration';
  END IF;
  IF EXISTS (SELECT 1 FROM app.integration_records r WHERE r.updated_at > (
    SELECT applied_at FROM app.schema_migrations WHERE version='gen_2922_credentials_prepared'
  )) THEN
    RAISE EXCEPTION 'Credential data changed after preparation; pause writes and prepare again';
  END IF;
END $$;
DROP TABLE app.credential_run_enrollments;
DROP TABLE app.credential_run_grants;
DROP TABLE app.credential_proxy_browser_pairings;
DROP TABLE app.credential_proxy_control_credentials;
DROP TABLE app.credential_proxy_states;
DROP TABLE app.run_credentials;
DROP TABLE app.unlock_key_verifications;
DROP TABLE app.integration_generation_previous_changes;
DROP TABLE app.integration_generation_previous_records;
DROP TABLE app.integration_generation_changes;
DROP TABLE app.integration_generation_records;
DROP TABLE app.integration_generation_journal;
ALTER TABLE app.integration_collections DROP COLUMN changes_pruned_through;
INSERT INTO app.schema_migrations(version) VALUES ('0052_retire_credential_proxy') ON CONFLICT DO NOTHING;
