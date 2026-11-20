CREATE TABLE app.user_run_defaults (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app.auth_users(id) ON DELETE CASCADE,
  run_defaults jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

INSERT INTO app.schema_migrations(version) VALUES ('0066_user_run_defaults') ON CONFLICT DO NOTHING;
