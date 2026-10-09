CREATE TABLE IF NOT EXISTS app.oauth_device_authorizations (
  device_code text PRIMARY KEY,
  user_code text NOT NULL UNIQUE,
  record jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oauth_device_authorizations_expires ON app.oauth_device_authorizations(expires_at);

INSERT INTO app.schema_migrations(version) VALUES ('0005_oauth_device_authorizations') ON CONFLICT DO NOTHING;
