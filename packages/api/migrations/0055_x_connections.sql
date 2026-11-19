CREATE TABLE app.x_connections (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  name text NOT NULL,
  client_id text NOT NULL,
  scopes text[] NOT NULL,
  encrypted_secret text NOT NULL,
  account_id text,
  account_handle text,
  granted_scopes text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','connected','reconnect_required')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id)
);
CREATE UNIQUE INDEX x_connections_tenant_name_ci ON app.x_connections(tenant_id,lower(name));
INSERT INTO app.schema_migrations(version) VALUES ('0055_x_connections') ON CONFLICT DO NOTHING;
