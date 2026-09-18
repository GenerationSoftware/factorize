-- Destructive cutover: terminal transcripts are intentionally not migrated.
DROP TABLE IF EXISTS app.run_transcripts;
ALTER TABLE app.runs DROP COLUMN IF EXISTS result;
ALTER TABLE app.runs DROP COLUMN IF EXISTS output_captured;
ALTER TABLE app.runs ADD COLUMN IF NOT EXISTS artifact_state text NOT NULL DEFAULT 'pending';
ALTER TABLE app.runs ADD COLUMN IF NOT EXISTS artifact_error text;
ALTER TABLE app.jobs ADD COLUMN IF NOT EXISTS model text NOT NULL DEFAULT '';
ALTER TABLE app.jobs ADD COLUMN IF NOT EXISTS effort text NOT NULL DEFAULT '';
ALTER TABLE app.runs DROP CONSTRAINT IF EXISTS runs_artifact_state_check;
ALTER TABLE app.runs ADD CONSTRAINT runs_artifact_state_check CHECK (artifact_state IN ('pending','collecting','stored','partial','failed'));

CREATE TABLE IF NOT EXISTS app.run_artifacts (tenant_id uuid NOT NULL, run_id uuid NOT NULL, id uuid NOT NULL, kind text NOT NULL CHECK (kind IN ('native_session','related_session','terminal_log','manifest')), object_key text NOT NULL, provider text NOT NULL, format text NOT NULL, format_version text, cli_version text, native_session_id text, byte_size bigint NOT NULL CHECK (byte_size >= 0), sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'), state text NOT NULL CHECK (state IN ('pending','collecting','stored','partial','failed')), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id,id), UNIQUE (tenant_id,object_key), FOREIGN KEY (tenant_id,run_id) REFERENCES app.runs(tenant_id,id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS run_artifacts_by_run ON app.run_artifacts (tenant_id,run_id,created_at,id);
CREATE TABLE IF NOT EXISTS app.run_trace_events (tenant_id uuid NOT NULL, run_id uuid NOT NULL, sequence bigint NOT NULL CHECK (sequence > 0), id text NOT NULL, parent_id text, event_type text NOT NULL CHECK (event_type IN ('user_message','assistant_message','reasoning','tool_call','tool_result','command','file_change','compaction','branch','usage','warning','error','metadata')), role text, title text NOT NULL, preview_text text NOT NULL, display_data jsonb NOT NULL DEFAULT '{}', occurred_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english',title || ' ' || preview_text)) STORED, PRIMARY KEY (tenant_id,run_id,sequence), FOREIGN KEY (tenant_id,run_id) REFERENCES app.runs(tenant_id,id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS run_trace_events_search ON app.run_trace_events USING gin (search_vector);
CREATE INDEX IF NOT EXISTS run_trace_events_by_type ON app.run_trace_events (tenant_id,run_id,event_type,sequence);

-- The product decision is to discard all pre-artifact run history.
TRUNCATE app.run_trace_events, app.run_artifacts, app.active_claims, app.lifecycle_deliveries, app.run_activity, app.runs, app.job_runs, app.invocations CASCADE;

INSERT INTO app.schema_migrations(version) VALUES ('0002_native_run_artifacts') ON CONFLICT DO NOTHING;
