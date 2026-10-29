CREATE TABLE app.vm_image_verifications (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  job_id uuid,
  status text NOT NULL CHECK (status IN ('queued','creating','checking_ssh','checking_agent','cleaning_up','succeeded','failed','cleanup_failed')),
  phase text NOT NULL,
  config jsonb NOT NULL,
  error_kind text,
  error text,
  vm_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id)
);
CREATE INDEX vm_image_verifications_status_idx ON app.vm_image_verifications(status,updated_at);
