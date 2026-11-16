CREATE TABLE app.vendor_run_identity_bindings (
  tenant_id uuid NOT NULL,
  run_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('exe.dev','fly.io')),
  vm_id text NOT NULL CHECK (length(vm_id) BETWEEN 1 AND 255),
  issuer text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 512),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 512),
  audience text NOT NULL CHECK (length(audience) BETWEEN 1 AND 512),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, run_id, provider),
  UNIQUE (provider, vm_id),
  UNIQUE (provider, issuer, subject, audience),
  CHECK (expires_at > issued_at),
  FOREIGN KEY (tenant_id, run_id) REFERENCES app.job_runs(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX vendor_run_identity_bindings_active
  ON app.vendor_run_identity_bindings(tenant_id, run_id, provider)
  WHERE revoked_at IS NULL;

INSERT INTO app.schema_migrations(version) VALUES ('0048_vendor_run_identity_bindings') ON CONFLICT DO NOTHING;
