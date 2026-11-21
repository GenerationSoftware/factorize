CREATE TABLE app.skill_git_namespaces (
  tenant_id uuid PRIMARY KEY REFERENCES app.tenants(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE CHECK (length(slug) BETWEEN 1 AND 63 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
CREATE TABLE app.skill_git_tokens (
  digest text PRIMARY KEY,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  repo text NOT NULL,
  session_version integer NOT NULL,
  expires_at timestamptz NOT NULL,
  FOREIGN KEY(tenant_id,user_id) REFERENCES app.members(tenant_id,user_id) ON DELETE CASCADE
);
CREATE INDEX skill_git_tokens_expiry ON app.skill_git_tokens(expires_at);
