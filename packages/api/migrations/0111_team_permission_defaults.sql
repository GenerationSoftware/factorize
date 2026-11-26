-- Team defaults are a consent preference, never a runtime grant.
CREATE TABLE app.team_permission_defaults (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  permission text NOT NULL,
  enabled boolean NOT NULL,
  PRIMARY KEY (tenant_id, permission)
);

-- Existing integrations have already been configured; don't prompt again.
INSERT INTO app.team_permission_defaults(tenant_id,permission,enabled)
  SELECT tenant_id,'integration:' || id,false FROM app.agent_integrations;

INSERT INTO app.team_permission_defaults(tenant_id,permission,enabled)
  SELECT DISTINCT p.tenant_id,
    CASE WHEN s.scope LIKE 'integration:%' THEN split_part(s.scope, ':', 1) || ':' || split_part(s.scope, ':', 2)
         ELSE s.scope END, true
  FROM app.permission_presets p CROSS JOIN LATERAL unnest(p.scopes) s(scope)
  WHERE p.is_default
  ON CONFLICT (tenant_id,permission) DO UPDATE SET enabled=excluded.enabled;
-- Preset rows are retained for rollback/history; no current API or runtime uses them.
