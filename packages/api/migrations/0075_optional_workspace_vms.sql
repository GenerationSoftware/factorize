-- Keep the effective workspace requirements of existing configurations while
-- new personal Teams and new agent defaults start without a VM requirement.
UPDATE app.team_settings SET run_defaults=run_defaults||jsonb_build_object('requiresVm',coalesce((run_defaults->>'requiresVm')::boolean,nullif(run_defaults->>'executionConfigId','') IS NOT NULL));
ALTER TABLE app.team_settings ALTER COLUMN run_defaults SET DEFAULT '{"capacity":4,"concurrencyLimit":1,"requiresVm":false,"runScopes":["team:read","triggers:read","runs:read","integrations:read","skills:read","runs:invoke"],"portableIntegrationIds":[],"githubInstallationIds":[],"linearConnectionId":null,"xConnectionIds":[],"allowedTriggerIds":[]}'::jsonb;
UPDATE app.triggers SET execution_config=execution_config||jsonb_build_object('requiresVm',coalesce(execution_config->>'executionType','agent')='code' OR nullif(execution_config->>'connectionId','') IS NOT NULL);
CREATE TABLE app.run_workspaces (
 tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
 -- Independent cleanup receipt: retained even if a run aggregate is removed.
 run_id uuid NOT NULL,
 provider text NOT NULL CHECK(provider IN ('exe','fly')),
 connection_id text NOT NULL,
 integration_id uuid NOT NULL,
 integration_epoch integer NOT NULL,
 configuration jsonb NOT NULL,
 handle jsonb NOT NULL,
 encrypted_proof text NOT NULL,
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','provisioning','ready','failed','cleaning','deleted')),
 lease_id uuid,
 lease_expires_at timestamptz,
 verified_at timestamptz,
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,run_id)
);
CREATE INDEX run_workspaces_cleanup ON app.run_workspaces(updated_at) WHERE status<>'deleted';
INSERT INTO app.schema_migrations(version) VALUES('0075_optional_workspace_vms') ON CONFLICT DO NOTHING;
