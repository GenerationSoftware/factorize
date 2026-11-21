CREATE TABLE app.oidc_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL REFERENCES app.oauth_apps(id) ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  challenge text NOT NULL,
  state text,
  nonce text,
  scopes text[] NOT NULL,
  expires_at timestamptz NOT NULL,
  decided_at timestamptz
);
CREATE INDEX oidc_requests_expiry ON app.oidc_requests(expires_at);
CREATE TABLE app.oidc_codes (
  digest text PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES app.oauth_app_connections(id) ON DELETE CASCADE,
  secret_version integer NOT NULL,
  redirect_uri text NOT NULL,
  challenge text NOT NULL,
  nonce text,
  expires_at timestamptz NOT NULL
);
CREATE INDEX oidc_codes_expiry ON app.oidc_codes(expires_at);
CREATE TABLE app.oidc_tokens (
  access_digest text PRIMARY KEY,
  refresh_digest text UNIQUE,
  connection_id uuid NOT NULL REFERENCES app.oauth_app_connections(id) ON DELETE CASCADE,
  secret_version integer NOT NULL,
  scopes text[] NOT NULL,
  access_expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz
);
CREATE INDEX oidc_tokens_expiry ON app.oidc_tokens(access_expires_at, refresh_expires_at);
CREATE TABLE app.oidc_signing_key (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  kid uuid NOT NULL DEFAULT gen_random_uuid(),
  public_key jsonb NOT NULL,
  encrypted_private_key text NOT NULL
);
INSERT INTO app.schema_migrations(version) VALUES ('0096_oidc_provider');
