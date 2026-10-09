ALTER TABLE app.run_artifacts DROP CONSTRAINT IF EXISTS run_artifacts_kind_check;
ALTER TABLE app.run_artifacts ADD CONSTRAINT run_artifacts_kind_check CHECK (kind IN ('execution_stream','native_session','related_session','terminal_log','manifest'));
ALTER TABLE app.run_artifacts ADD COLUMN source_path text;
ALTER TABLE app.run_artifacts ADD COLUMN media_type text;
ALTER TABLE app.run_artifacts ADD COLUMN harness_version text;
ALTER TABLE app.runs ADD COLUMN trace_sources jsonb;
