CREATE TABLE app.cloudflare_connections (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  account_id text NOT NULL,
  account_name text NOT NULL,
  write_enabled boolean NOT NULL,
  encrypted_credentials text,
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,account_id)
);
CREATE TABLE app.cloudflare_oauth_attempts (
  tenant_id uuid PRIMARY KEY REFERENCES app.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app.auth_users(id) ON DELETE CASCADE,
  session_version integer NOT NULL,
  state uuid NOT NULL UNIQUE,
  verifier text,
  scopes text[] NOT NULL,
  write_requested boolean NOT NULL,
  encrypted_pending text,
  expires_at timestamptz NOT NULL
);
CREATE INDEX cloudflare_oauth_expiry ON app.cloudflare_oauth_attempts(expires_at);
ALTER TABLE app.agent_integrations DROP CONSTRAINT agent_integrations_kind_check;
ALTER TABLE app.agent_integrations ADD CONSTRAINT agent_integrations_kind_check
  CHECK(kind IN ('bearer','github','linear','fly','exe','amp','clickup','x','cloudflare'));
