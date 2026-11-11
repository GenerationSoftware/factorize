CREATE TABLE app.fly_connections (
  tenant_id uuid PRIMARY KEY REFERENCES app.tenants(id) ON DELETE CASCADE,
  organization_slug text NOT NULL CHECK (organization_slug ~ '^[a-z0-9-]{1,63}$'),
  organization_name text NOT NULL CHECK (length(organization_name) BETWEEN 1 AND 120),
  encrypted_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
