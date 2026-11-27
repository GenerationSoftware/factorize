CREATE TABLE app.hetzner_server_requests (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES app.auth_users(id) ON DELETE CASCADE,
  installation_id text NOT NULL,
  request_id uuid NOT NULL,
  project_revision uuid NOT NULL,
  ticket uuid NOT NULL UNIQUE,
  name text NOT NULL,
  server_type text NOT NULL,
  location text NOT NULL,
  server_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, owner_id, installation_id, request_id),
  UNIQUE (tenant_id, project_revision, name),
  UNIQUE (tenant_id, project_revision, server_id)
);
