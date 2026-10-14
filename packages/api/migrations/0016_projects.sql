CREATE TABLE app.projects (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  id uuid NOT NULL, name text NOT NULL, description text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id), UNIQUE (tenant_id, name)
);
CREATE INDEX projects_tenant_updated ON app.projects(tenant_id, updated_at);
INSERT INTO app.projects(tenant_id,id,name,description)
SELECT t.id, md5(t.id::text || ':default')::uuid, 'Default', 'Jobs migrated from the legacy jobs collection.'
FROM app.tenants t WHERE EXISTS (SELECT 1 FROM app.jobs j WHERE j.tenant_id=t.id)
ON CONFLICT (tenant_id,name) DO NOTHING;
ALTER TABLE app.jobs ADD COLUMN project_id uuid;
UPDATE app.jobs j SET project_id=p.id FROM app.projects p WHERE p.tenant_id=j.tenant_id AND p.name='Default' AND j.project_id IS NULL;
ALTER TABLE app.jobs ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE app.jobs ADD CONSTRAINT jobs_project_fk FOREIGN KEY (tenant_id,project_id) REFERENCES app.projects(tenant_id,id) ON DELETE RESTRICT;
CREATE INDEX jobs_tenant_project_updated ON app.jobs(tenant_id,project_id,updated_at);
