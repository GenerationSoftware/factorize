-- The installation owns policy and durable subscriptions. Provider grants are replaceable credentials.
-- Legacy installations use their exact original grant ID so subscription IDs and ownership stay unchanged.
CREATE TABLE app.oauth_installations (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app.auth_users(id) ON DELETE CASCADE,
  id text NOT NULL,
  client_id text NOT NULL,
  redirect_uri text NOT NULL,
  display_name text,
  selected_scopes text[] NOT NULL DEFAULT '{}',
  active_grant_id text,
  active_session_version integer,
  active_scopes text[] NOT NULL DEFAULT '{}',
  legacy_implicit_scopes text[] NOT NULL DEFAULT '{}',
  active_expires_at timestamptz,
  policy_revision integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,user_id,id),
  UNIQUE (tenant_id,active_grant_id),
  CHECK ((active_grant_id IS NULL) = (active_session_version IS NULL))
);

CREATE TABLE app.oauth_installation_issuances (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  installation_id text NOT NULL,
  expected_revision integer NOT NULL,
  session_version integer NOT NULL,
  selected_scopes text[] NOT NULL,
  credential_scopes text[] NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  FOREIGN KEY (tenant_id,user_id,installation_id) REFERENCES app.oauth_installations(tenant_id,user_id,id) ON DELETE CASCADE
);
CREATE INDEX oauth_installation_issuances_expiry ON app.oauth_installation_issuances (expires_at);

-- Bound legacy implicit access to the baseline integrations/epochs that existed at cutover.
-- Provider grant claims are held outside PostgreSQL; safely adopt their snapshots individually.
CREATE TABLE app.oauth_legacy_baselines (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  scope text NOT NULL,
  PRIMARY KEY (tenant_id,scope)
);
INSERT INTO app.oauth_legacy_baselines(tenant_id,scope)
SELECT tenant_id, 'integration:' || id || ':' || epoch FROM app.agent_integrations WHERE available AND policy='baseline';
