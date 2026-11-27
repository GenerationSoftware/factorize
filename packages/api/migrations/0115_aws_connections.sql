CREATE TABLE app.aws_connections (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app.auth_users(id) ON DELETE CASCADE,
  name text NOT NULL,
  region text NOT NULL,
  role_arn text,
  oauth_installation_id text,
  revision integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX aws_connections_owner_idx ON app.aws_connections (tenant_id, user_id);
