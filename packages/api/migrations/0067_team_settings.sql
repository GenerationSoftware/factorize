-- Settings are owned by the tenant (personal team), even before provider setup.
CREATE TABLE app.team_settings (
  tenant_id uuid PRIMARY KEY REFERENCES app.tenants(id) ON DELETE CASCADE,
  run_defaults jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Preserve the oldest project's defaults, using its owner's personal defaults
-- for fields that were omitted. Never borrow another member's credentials.
INSERT INTO app.team_settings(tenant_id,run_defaults)
SELECT t.id, COALESCE(u.run_defaults,'{}'::jsonb) || COALESCE(p.run_defaults,'{}'::jsonb)
FROM app.tenants t
LEFT JOIN LATERAL (
  SELECT d.run_defaults FROM app.user_run_defaults d
  JOIN app.members m ON m.tenant_id=d.tenant_id AND m.user_id=d.user_id
  WHERE d.tenant_id=t.id AND m.role='owner'
  ORDER BY m.created_at,m.user_id LIMIT 1
) u ON true
LEFT JOIN LATERAL (
  SELECT run_defaults FROM app.projects
  WHERE tenant_id=t.id AND run_defaults IS NOT NULL
  ORDER BY created_at,id LIMIT 1
) p ON true;

CREATE FUNCTION app.initialize_team_settings() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO app.team_settings(tenant_id) VALUES (NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER initialize_team_settings AFTER INSERT ON app.tenants
FOR EACH ROW EXECUTE FUNCTION app.initialize_team_settings();

INSERT INTO app.schema_migrations(version) VALUES ('0067_team_settings') ON CONFLICT DO NOTHING;
