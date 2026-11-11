ALTER TABLE app.runs ADD COLUMN IF NOT EXISTS failure_code text;
ALTER TABLE app.runs ADD COLUMN IF NOT EXISTS failure_reason text;
ALTER TABLE app.runs DROP CONSTRAINT IF EXISTS runs_failure_outcome_check;
ALTER TABLE app.runs ADD CONSTRAINT runs_failure_outcome_check CHECK (
  (failure_code IS NULL AND failure_reason IS NULL) OR
  (failure_code IS NOT NULL AND failure_reason IS NOT NULL)
);

-- Only direct retained evidence proves a task failure here.
UPDATE app.runs
SET failure_source='agent', failure_code='task_reported_failure',
    failure_reason=job_result->>'reason',
    artifact_error=CASE WHEN artifact_error=job_result->>'reason' THEN NULL ELSE artifact_error END
WHERE state='failed' AND failure_source='system'
  AND job_result->>'status'='failed'
  AND execution_diagnostics->>'state'='succeeded'
  AND execution_diagnostics->'systemd'->>'result'='success'
  AND execution_diagnostics->'systemd'->>'execMainStatus'='0'
  AND coalesce(job_result->>'reason','') <> '';

INSERT INTO app.schema_migrations(version) VALUES ('0032_run_failure_outcomes') ON CONFLICT DO NOTHING;
