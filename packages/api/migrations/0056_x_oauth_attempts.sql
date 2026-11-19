CREATE TABLE app.x_oauth_attempts (
  tenant_id uuid NOT NULL,
  nonce text NOT NULL,
  user_id uuid NOT NULL,
  session_version integer NOT NULL,
  connection_id uuid NOT NULL,
  scopes text[] NOT NULL,
  encrypted_verifier text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  PRIMARY KEY (tenant_id, nonce),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES app.x_connections(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX x_oauth_attempt_expiry ON app.x_oauth_attempts(expires_at);
INSERT INTO app.schema_migrations(version) VALUES ('0056_x_oauth_attempts') ON CONFLICT DO NOTHING;
