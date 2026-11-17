CREATE TABLE app.model_device_authorizations (
  tenant_id uuid NOT NULL,
  account_id uuid NOT NULL,
  user_id uuid NOT NULL,
  session_version integer NOT NULL,
  encrypted_payload text NOT NULL,
  expires_at timestamptz NOT NULL,
  next_poll_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id,account_id),
  FOREIGN KEY (tenant_id,account_id) REFERENCES app.integration_records(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX model_device_authorizations_expiry ON app.model_device_authorizations(expires_at);
INSERT INTO app.schema_migrations(version) VALUES ('0051_model_device_authorizations') ON CONFLICT DO NOTHING;
