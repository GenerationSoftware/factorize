ALTER TABLE app.runs
  ADD COLUMN failure_source text,
  ADD COLUMN agent_error_reason text,
  ADD COLUMN agent_error_reported_at timestamptz,
  ADD COLUMN agent_error_reporter_user_id uuid,
  ADD COLUMN agent_error_reporter_kind text,
  ADD COLUMN agent_error_reporter_id text;

UPDATE app.runs SET failure_source='system' WHERE state='failed';

ALTER TABLE app.runs ADD CONSTRAINT runs_failure_source_check
  CHECK (failure_source IS NULL OR failure_source IN ('system','agent'));
ALTER TABLE app.runs ADD CONSTRAINT runs_failure_source_state_check
  CHECK (failure_source IS NULL OR state='failed');
ALTER TABLE app.runs ADD CONSTRAINT runs_agent_error_report_check
  CHECK ((agent_error_reason IS NULL AND agent_error_reported_at IS NULL AND agent_error_reporter_user_id IS NULL AND agent_error_reporter_kind IS NULL AND agent_error_reporter_id IS NULL)
      OR (agent_error_reason IS NOT NULL AND agent_error_reported_at IS NOT NULL AND agent_error_reporter_user_id IS NOT NULL AND agent_error_reporter_kind IS NOT NULL AND agent_error_reporter_id IS NOT NULL));
