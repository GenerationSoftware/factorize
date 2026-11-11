CREATE TABLE app.credential_proxy_states (
  tenant_id uuid PRIMARY KEY REFERENCES app.tenants(id) ON DELETE CASCADE,
  proxy_identity text NOT NULL,
  boot_epoch uuid NOT NULL,
  disabled_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.credential_run_grants (
  tenant_id uuid NOT NULL,
  run_id uuid NOT NULL,
  vm_identity text NOT NULL,
  proxy_identity text NOT NULL,
  boot_epoch uuid NOT NULL,
  grant_revision bigint NOT NULL CHECK (grant_revision > 0),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, run_id),
  FOREIGN KEY (tenant_id, run_id) REFERENCES app.job_runs(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE app.credential_run_enrollments (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  run_id uuid NOT NULL,
  token_digest bytea NOT NULL UNIQUE,
  vm_identity text NOT NULL,
  proxy_identity text NOT NULL,
  boot_epoch uuid NOT NULL,
  grant_revision bigint NOT NULL CHECK (grant_revision > 0),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, run_id) REFERENCES app.credential_run_grants(tenant_id, run_id) ON DELETE CASCADE
);
CREATE INDEX credential_run_enrollments_expiry ON app.credential_run_enrollments(expires_at) WHERE consumed_at IS NULL;
