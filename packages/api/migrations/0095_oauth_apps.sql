CREATE TABLE app.oauth_apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  redirect_uris text[] NOT NULL,
  is_public boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  secret_digest text,
  secret_version integer NOT NULL DEFAULT 0
);
CREATE INDEX oauth_apps_team ON app.oauth_apps(tenant_id);
CREATE TABLE app.oauth_app_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL REFERENCES app.oauth_apps(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app.auth_users(id) ON DELETE CASCADE,
  session_version integer NOT NULL,
  scopes text[] NOT NULL,
  authorized_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX oauth_app_connections_owner ON app.oauth_app_connections(tenant_id, user_id);
INSERT INTO app.schema_migrations(version) VALUES ('0095_oauth_apps');
