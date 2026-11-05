CREATE TABLE app.manual_invocation_permissions (
  tenant_id uuid NOT NULL,
  source_job_id uuid NOT NULL,
  destination_job_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, source_job_id, destination_job_id),
  FOREIGN KEY (tenant_id, source_job_id) REFERENCES app.jobs(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, destination_job_id) REFERENCES app.jobs(tenant_id,id) ON DELETE CASCADE,
  CHECK (source_job_id <> destination_job_id)
);
CREATE INDEX manual_invocation_permissions_destination ON app.manual_invocation_permissions(tenant_id,destination_job_id);

CREATE TABLE app.run_credentials (
  tenant_id uuid NOT NULL,
  run_id uuid NOT NULL,
  digest text NOT NULL,
  user_id uuid NOT NULL,
  session_version integer NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id,run_id),
  FOREIGN KEY (tenant_id,run_id) REFERENCES app.job_runs(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,user_id) REFERENCES app.members(tenant_id,user_id) ON DELETE CASCADE
);
CREATE INDEX run_credentials_digest ON app.run_credentials(digest);

ALTER TABLE app.invocations ADD COLUMN source_job_id uuid;
ALTER TABLE app.invocations ADD COLUMN source_run_id uuid;
CREATE INDEX invocations_source_run ON app.invocations(tenant_id,source_run_id) WHERE source_run_id IS NOT NULL;
