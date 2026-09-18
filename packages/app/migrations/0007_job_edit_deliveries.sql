CREATE TABLE app.job_edit_deliveries (
  tenant_id uuid NOT NULL,
  event_id uuid NOT NULL,
  trigger_id uuid NOT NULL,
  source_job_id uuid NOT NULL,
  edited_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, event_id, trigger_id),
  FOREIGN KEY (tenant_id, trigger_id) REFERENCES app.triggers(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, source_job_id) REFERENCES app.jobs(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX job_edit_deliveries_pending ON app.job_edit_deliveries(edited_at, event_id);

CREATE OR REPLACE FUNCTION app.next_wake_at() RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT min(candidate) FROM (
    SELECT min(not_before) candidate FROM app.wake_hints
    UNION ALL SELECT min(d.edited_at) FROM app.job_edit_deliveries d
      JOIN app.triggers t ON t.tenant_id=d.tenant_id AND t.id=d.trigger_id
      JOIN app.jobs j ON j.tenant_id=t.tenant_id AND j.id=t.job_id
      WHERE t.enabled AND t.removed_at IS NULL AND j.enabled
        AND t.config->'sourceJobIds' ? d.source_job_id::text AND t.config->'states' ? 'edited'
    UNION ALL SELECT min(next_run_at) FROM app.schedule_state
    UNION ALL SELECT min(next_attempt_at) FROM app.pending_verifications
    UNION ALL SELECT min(launch_lease_expires_at) FROM app.job_runs WHERE state='starting'
    UNION ALL SELECT min(next_poll_at) FROM app.job_runs WHERE state IN ('running','blocked','stopping')
    UNION ALL SELECT min(cleanup_next_at) FROM app.runs WHERE NOT vm_cleanup_complete
  ) wakes
$$;

