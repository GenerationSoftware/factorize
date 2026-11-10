CREATE INDEX job_runs_by_job_history
  ON app.job_runs (tenant_id,job_id,created_at DESC,id DESC,state);

CREATE INDEX job_runs_active_by_job
  ON app.job_runs (tenant_id,job_id)
  WHERE state IN ('reserved','starting','running','blocked','stopping');

INSERT INTO app.schema_migrations(version) VALUES ('0031_job_run_history_indexes') ON CONFLICT DO NOTHING;
