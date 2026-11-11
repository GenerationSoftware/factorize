CREATE INDEX runs_priority_order
  ON app.runs (tenant_id,
    (CASE WHEN state IN ('queued','reserved','starting') THEN 0 WHEN state='running' THEN 1 ELSE 2 END),
    created_at DESC,id DESC);

CREATE INDEX runs_priority_job_order
  ON app.runs (tenant_id,job_id,
    (CASE WHEN state IN ('queued','reserved','starting') THEN 0 WHEN state='running' THEN 1 ELSE 2 END),
    created_at DESC,id DESC);

INSERT INTO app.schema_migrations(version) VALUES ('0036_run_priority_order_indexes') ON CONFLICT DO NOTHING;
