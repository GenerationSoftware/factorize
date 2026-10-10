-- Admission reservations are durable capacity claims. They are converted to
-- starting by the scheduler, while queued remains the single waiting slot.
ALTER TABLE app.job_runs DROP CONSTRAINT IF EXISTS job_runs_state_check;
ALTER TABLE app.job_runs ADD CONSTRAINT job_runs_state_check CHECK (state IN ('queued','reserved','starting','running','blocked','stopping','succeeded','failed','stopped'));
CREATE INDEX IF NOT EXISTS job_runs_reserved ON app.job_runs (created_at,id) WHERE state='reserved';

-- Keep a durable reservation visible to the alarm coordinator even if the
-- wake hint was consumed by a scheduler that crashed before claiming it.
CREATE OR REPLACE FUNCTION app.next_wake_at() RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT min(candidate) FROM (
    SELECT min(not_before) candidate FROM app.wake_hints
    UNION ALL SELECT min(next_run_at) FROM app.schedule_state
    UNION ALL SELECT min(next_attempt_at) FROM app.pending_verifications
    UNION ALL SELECT min(created_at) FROM app.job_runs WHERE state='reserved'
    UNION ALL SELECT min(launch_lease_expires_at) FROM app.job_runs WHERE state='starting'
    UNION ALL SELECT min(next_poll_at) FROM app.job_runs WHERE state IN ('running','blocked','stopping')
    UNION ALL SELECT min(cleanup_next_at) FROM app.runs WHERE NOT vm_cleanup_complete
  ) wakes
$$;
