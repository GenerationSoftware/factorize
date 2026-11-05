ALTER TABLE app.runs ADD COLUMN result_protocol_version integer NOT NULL DEFAULT 0;
ALTER TABLE app.runs ADD COLUMN job_result jsonb;
ALTER TABLE app.runs ADD CONSTRAINT runs_result_protocol_version_check CHECK (result_protocol_version IN (0,1));
ALTER TABLE app.run_artifacts DROP CONSTRAINT IF EXISTS run_artifacts_kind_check;
ALTER TABLE app.run_artifacts ADD CONSTRAINT run_artifacts_kind_check CHECK (kind IN ('execution_stream','native_session','related_session','terminal_log','manifest','job_file'));
INSERT INTO app.schema_migrations(version) VALUES ('0026_structured_job_results') ON CONFLICT DO NOTHING;
