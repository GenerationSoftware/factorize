-- Resolve legacy target references before permanently removing their table.
UPDATE app.jobs j SET execution_target = (j.execution_target - 'targetId') || jsonb_build_object('connectionId', t.integration_id, 'agentKind', t.agent_kind)
FROM app.execution_targets t WHERE t.tenant_id=j.tenant_id AND j.execution_target->>'targetId'=t.id::text;
UPDATE app.runs r SET execution_target = (r.execution_target - 'targetId') || jsonb_build_object('connectionId', t.integration_id, 'agentKind', t.agent_kind)
FROM app.execution_targets t WHERE t.tenant_id=r.tenant_id AND r.execution_target->>'targetId'=t.id::text;
DROP TABLE IF EXISTS app.execution_targets;
ALTER TABLE app.jobs RENAME COLUMN execution_target TO execution_config;
ALTER TABLE app.runs RENAME COLUMN execution_target TO execution_config;
