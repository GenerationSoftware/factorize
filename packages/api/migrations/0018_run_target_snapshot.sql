ALTER TABLE app.runs ADD COLUMN execution_target jsonb;
UPDATE app.runs r SET execution_target = j.execution_target || jsonb_build_object('model', j.model, 'effort', j.effort)
FROM app.jobs j WHERE j.tenant_id=r.tenant_id AND j.id=r.job_id AND r.execution_target IS NULL;
ALTER TABLE app.runs ALTER COLUMN execution_target SET NOT NULL;
