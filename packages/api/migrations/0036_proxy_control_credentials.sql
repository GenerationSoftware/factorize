CREATE TABLE app.credential_proxy_control_credentials (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  proxy_identity text NOT NULL,
  boot_epoch uuid NOT NULL,
  token_digest bytea NOT NULL UNIQUE,
  revoked_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, proxy_identity)
);
