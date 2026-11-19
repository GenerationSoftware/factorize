CREATE TABLE app.skill_libraries (
  tenant_id uuid PRIMARY KEY REFERENCES app.tenants(id) ON DELETE CASCADE,
  repo text NOT NULL UNIQUE,
  remote text NOT NULL,
  source jsonb NOT NULL,
  commit_sha text,
  upstream_sha text,
  error text,
  checked_at timestamptz
);
ALTER TABLE app.skills ADD COLUMN encrypted_directory text;
