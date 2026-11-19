ALTER TABLE app.job_skills ADD COLUMN context_skill boolean NOT NULL DEFAULT true;
ALTER TABLE app.projects ADD COLUMN run_defaults jsonb;
ALTER TABLE app.invocations ALTER COLUMN job_id DROP NOT NULL, ALTER COLUMN trigger_id DROP NOT NULL,
  ADD FOREIGN KEY (tenant_id) REFERENCES app.tenants(id) ON DELETE CASCADE,
  ADD COLUMN caller text, ADD COLUMN request_hash text,
  DROP CONSTRAINT invocations_source_check,
  ADD CONSTRAINT invocations_source_check CHECK(source IN ('manual','schedule','webhook','jobLifecycle','jobIdle','direct'));
ALTER TABLE app.job_runs ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE app.runs ALTER COLUMN job_id DROP NOT NULL, ADD COLUMN project_id uuid,
  ADD COLUMN launch_skill_id uuid, ADD COLUMN launch_skill_key text, ADD COLUMN launch_skill_revision integer,
  ADD COLUMN source_job_name text;
UPDATE app.runs r SET project_id=j.project_id,source_job_name=j.name FROM app.jobs j WHERE j.tenant_id=r.tenant_id AND j.id=r.job_id;
ALTER TABLE app.runs ALTER COLUMN project_id SET NOT NULL,
  ADD FOREIGN KEY(tenant_id,project_id) REFERENCES app.projects(tenant_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE app.invocations ADD COLUMN template_job_id uuid, ADD COLUMN origin_trigger_id uuid;
UPDATE app.invocations SET template_job_id=job_id,origin_trigger_id=trigger_id;
CREATE FUNCTION app.snapshot_invocation_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.template_job_id := NEW.job_id;
  NEW.origin_trigger_id := NEW.trigger_id;
  RETURN NEW;
END $$;
CREATE TRIGGER snapshot_invocation_origin BEFORE INSERT ON app.invocations FOR EACH ROW EXECUTE FUNCTION app.snapshot_invocation_origin();
-- Allow the previous application writer to continue inserting job launches during rollout.
CREATE FUNCTION app.capture_run_project() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.job_id IS NOT NULL THEN
    SELECT project_id,name INTO NEW.project_id,NEW.source_job_name FROM app.jobs WHERE tenant_id=NEW.tenant_id AND id=NEW.job_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER capture_run_project BEFORE INSERT ON app.runs FOR EACH ROW EXECUTE FUNCTION app.capture_run_project();
ALTER TABLE app.runs DROP CONSTRAINT runs_tenant_id_job_id_fkey, ADD FOREIGN KEY(tenant_id,job_id) REFERENCES app.jobs(tenant_id,id) ON DELETE SET NULL (job_id);
ALTER TABLE app.job_runs DROP CONSTRAINT job_runs_tenant_id_job_id_fkey, ADD FOREIGN KEY(tenant_id,job_id) REFERENCES app.jobs(tenant_id,id) ON DELETE SET NULL (job_id);
ALTER TABLE app.invocations DROP CONSTRAINT invocations_tenant_id_job_id_fkey, ADD FOREIGN KEY(tenant_id,job_id) REFERENCES app.jobs(tenant_id,id) ON DELETE SET NULL (job_id),
  DROP CONSTRAINT invocations_tenant_id_trigger_id_fkey, ADD FOREIGN KEY(tenant_id,trigger_id) REFERENCES app.triggers(tenant_id,id) ON DELETE SET NULL (trigger_id);
CREATE UNIQUE INDEX direct_run_claim ON app.invocations(tenant_id,caller,claim_key) WHERE source='direct';
CREATE INDEX runs_project_skill ON app.runs(tenant_id,project_id,launch_skill_id,created_at DESC,id DESC);
CREATE INDEX runs_skill ON app.runs(tenant_id,launch_skill_id,created_at DESC,id DESC);

-- A terminal run has one outcome for its lifetime. Recording it on the row
-- covers queued cancellations as well as the scheduler's terminal transaction.
ALTER TABLE app.runs ADD COLUMN outcome_id uuid;
UPDATE app.runs SET outcome_id=id WHERE state IN ('succeeded','failed','stopped');
CREATE FUNCTION app.capture_run_outcome() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IN ('succeeded','failed','stopped') THEN NEW.outcome_id := NEW.id; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER capture_run_outcome BEFORE INSERT OR UPDATE OF state ON app.runs FOR EACH ROW EXECUTE FUNCTION app.capture_run_outcome();

INSERT INTO app.schema_migrations(version) VALUES ('0061_project_runs') ON CONFLICT DO NOTHING;
