-- Fail closed on ambiguous legacy email identities; reconcile any duplicates before deployment.
CREATE UNIQUE INDEX auth_users_email_normalized ON app.auth_users(lower(email));
ALTER TABLE app.auth_users ADD COLUMN username text UNIQUE;
ALTER TABLE app.auth_users ADD CONSTRAINT auth_users_username_check CHECK (username IS NULL OR username ~ '^[a-z0-9_][a-z0-9_-]{2,31}$');
ALTER TABLE app.auth_reset_tokens ADD COLUMN purpose text NOT NULL DEFAULT 'reset' CHECK (purpose IN ('verify','reset'));
CREATE TABLE app.linear_workspaces (
  organization_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL UNIQUE REFERENCES app.tenants(id) ON DELETE CASCADE
);
-- Legacy Linear login used the organization UUID as the tenant UUID. Preserve
-- these bindings and all existing encrypted credentials and tenant data.
INSERT INTO app.linear_workspaces(organization_id,tenant_id)
SELECT tenant_id,tenant_id FROM app.connections WHERE kind='linear';

-- Retire browser/API sessions issued to unverified users by the old signup path.
UPDATE app.members m SET session_version=session_version+1
FROM app.auth_users u WHERE u.id=m.user_id AND NOT u.email_verified;
