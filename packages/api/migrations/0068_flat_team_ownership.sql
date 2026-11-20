-- Keep historic project records and associations as migration provenance. New
-- jobs and runs use tenant ownership directly and never require a project row.
-- Remove previously ineffective grants before widening invocation to the team.
DELETE FROM app.manual_invocation_permissions p USING app.jobs s, app.jobs d
WHERE s.tenant_id=p.tenant_id AND s.id=p.source_job_id
  AND d.tenant_id=p.tenant_id AND d.id=p.destination_job_id
  AND s.project_id IS DISTINCT FROM d.project_id;
ALTER TABLE app.jobs ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE app.runs ALTER COLUMN project_id DROP NOT NULL;
DROP TRIGGER capture_run_project ON app.runs;
DROP FUNCTION app.capture_run_project();
CREATE FUNCTION app.capture_run_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.job_id IS NOT NULL THEN
    SELECT name INTO NEW.source_job_name FROM app.jobs WHERE tenant_id=NEW.tenant_id AND id=NEW.job_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER capture_run_source BEFORE INSERT ON app.runs FOR EACH ROW EXECUTE FUNCTION app.capture_run_source();
UPDATE app.access_tokens SET scopes=replace(replace(scopes::text,'"projects:read"','"team:read"'),'"projects:write"','"team:write"')::jsonb;
UPDATE app.run_authorizations SET scopes=replace(replace(scopes::text,'"projects:read"','"team:read"'),'"projects:write"','"team:write"')::jsonb;
UPDATE app.jobs SET run_scopes=replace(replace(run_scopes::text,'"projects:read"','"team:read"'),'"projects:write"','"team:write"')::jsonb;
-- Accounts without ownership get a separate personal team. Existing membership
-- and roles in other teams are preserved.
WITH missing AS MATERIALIZED (
  SELECT u.id user_id,u.email,gen_random_uuid() team_id FROM app.auth_users u
  WHERE NOT EXISTS (SELECT 1 FROM app.members m WHERE m.user_id=u.id AND m.role='owner')
), created AS (
  INSERT INTO app.tenants(id) SELECT team_id FROM missing RETURNING id
)
INSERT INTO app.members(tenant_id,user_id,email,role)
SELECT c.id,m.user_id,m.email,'owner' FROM missing m JOIN created c ON c.id=m.team_id;
INSERT INTO app.schema_migrations(version) VALUES ('0068_flat_team_ownership') ON CONFLICT DO NOTHING;
ALTER TABLE app.jobs ALTER COLUMN run_scopes SET DEFAULT '["team:read","jobs:read","runs:read","integrations:read","skills:read","runs:invoke"]'::jsonb;
