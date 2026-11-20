-- Rename application concepts without changing resource identities or history.
-- Delivery IDs identify outbox records independently of their destination Event.
CREATE TEMP TABLE factorize_function_definitions ON COMMIT DROP AS
SELECT pg_get_functiondef(p.oid) definition FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app';
CREATE TEMP TABLE factorize_event_indexes ON COMMIT DROP AS
SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='app'
AND indexdef ~ '(jobLifecycle|jobIdle|sourceJobIds|sourceJobId)';

ALTER TABLE app.job_edit_deliveries RENAME COLUMN event_id TO delivery_id;
ALTER TABLE app.lifecycle_events RENAME COLUMN event_id TO delivery_id;
ALTER TABLE app.triggers RENAME TO events;
ALTER TABLE app.jobs RENAME TO triggers;
ALTER TABLE app.job_runs RENAME TO trigger_runs;
ALTER TABLE app.job_skills RENAME TO trigger_skills;
ALTER TABLE app.job_events RENAME TO trigger_events;
ALTER TABLE app.job_edit_deliveries RENAME TO trigger_edit_deliveries;
ALTER TABLE app.deleted_job_provider_cleanup RENAME TO deleted_trigger_provider_cleanup;

CREATE FUNCTION app.canonical_trigger_name(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
SELECT replace(replace(replace(replace(replace(replace(value,
 'Trigger','Event'),'trigger','event'),'Job','Trigger'),'job','trigger'),
 'evented','fired'),'eventing','firing')
$$;

DO $$
DECLARE field record;
BEGIN
  FOR field IN SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema='app' AND (column_name LIKE '%trigger%' OR column_name LIKE '%job%')
    ORDER BY (column_name LIKE '%trigger%') DESC,table_name,column_name
  LOOP
    EXECUTE format('ALTER TABLE app.%I RENAME COLUMN %I TO %I',field.table_name,field.column_name,app.canonical_trigger_name(field.column_name));
  END LOOP;
END $$;

-- PostgreSQL keeps function bodies as text. Refresh them after renaming relations
-- and columns, keeping the SQL trigger return type intact.
DO $$
DECLARE saved record; definition text;
BEGIN
  FOR saved IN SELECT * FROM factorize_function_definitions LOOP
    definition := replace(saved.definition,'event_id','delivery_id');
    definition := replace(definition,'RETURNS trigger','RETURNS FACTORIZE_TRIGGER_TYPE');
    definition := app.canonical_trigger_name(definition);
    definition := replace(definition,'RETURNS FACTORIZE_TRIGGER_TYPE','RETURNS trigger');
    EXECUTE definition;
  END LOOP;
  FOR saved IN SELECT * FROM factorize_event_indexes LOOP
    EXECUTE format('DROP INDEX app.%I',saved.indexname);
    EXECUTE app.canonical_trigger_name(saved.indexdef);
  END LOOP;
END $$;

ALTER TABLE app.events DROP CONSTRAINT triggers_kind_check;
ALTER TABLE app.invocations DROP CONSTRAINT invocations_source_check;
UPDATE app.events SET kind=CASE kind WHEN 'jobLifecycle' THEN 'triggerLifecycle' WHEN 'jobIdle' THEN 'triggerIdle' ELSE kind END,
  slug=regexp_replace(slug,'^trigger-([0-9]+)$','event-\1'),
  config=(config-'sourceJobIds'-'sourceJobId')
    || CASE WHEN config ? 'sourceJobIds' THEN jsonb_build_object('sourceTriggerIds',config->'sourceJobIds') ELSE '{}'::jsonb END
    || CASE WHEN config ? 'sourceJobId' THEN jsonb_build_object('sourceTriggerId',config->'sourceJobId') ELSE '{}'::jsonb END;
UPDATE app.invocations SET source=CASE source WHEN 'jobLifecycle' THEN 'triggerLifecycle' WHEN 'jobIdle' THEN 'triggerIdle' ELSE source END;
ALTER TABLE app.events ADD CONSTRAINT events_kind_check CHECK(kind IN ('manual','schedule','webhook','triggerLifecycle','triggerIdle'));
ALTER TABLE app.invocations ADD CONSTRAINT invocations_source_check CHECK(source IN ('manual','schedule','webhook','triggerLifecycle','triggerIdle','direct'));

ALTER TABLE app.run_artifacts DROP CONSTRAINT run_artifacts_kind_check;
UPDATE app.run_artifacts SET kind='trigger_file' WHERE kind='job_file';
ALTER TABLE app.run_artifacts ADD CONSTRAINT run_artifacts_kind_check
  CHECK(kind IN ('execution_stream','native_session','related_session','terminal_log','manifest','trigger_file'));

-- Migrate only Factorize's context envelope. Webhook payloads and caller data
-- retain their original keys and values.
UPDATE app.invocations i SET context=(SELECT COALESCE(jsonb_object_agg(
  regexp_replace(entry.key,'^trigger-([0-9]+)$','event-\1'),
  CASE WHEN i.source IN ('triggerLifecycle','triggerIdle') AND jsonb_typeof(entry.value)='object'
    THEN (entry.value-'sourceJobId'-'source_job_id')
      || CASE WHEN entry.value ? 'sourceJobId' THEN jsonb_build_object('sourceTriggerId',entry.value->'sourceJobId') ELSE '{}'::jsonb END
      || CASE WHEN entry.value ? 'source_job_id' THEN jsonb_build_object('source_trigger_id',entry.value->'source_job_id') ELSE '{}'::jsonb END
    ELSE entry.value END),'{}'::jsonb) FROM jsonb_each(i.context) entry) WHERE i.source<>'direct';

UPDATE app.invocations SET claim_key=regexp_replace(claim_key,'^job-edited:','trigger-edited:') WHERE source='triggerLifecycle';
UPDATE app.runs r SET issue_id=i.claim_key FROM app.invocations i WHERE i.tenant_id=r.tenant_id AND i.id=r.invocation_id AND i.source='triggerLifecycle' AND r.issue_id LIKE 'job-edited:%';

CREATE FUNCTION app.canonical_scope_array(value jsonb, expand_legacy boolean DEFAULT true) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
SELECT COALESCE(jsonb_agg(scopes.scope ORDER BY scopes.position),'[]'::jsonb) FROM (
  SELECT expanded.scope,min(entry.ordinality*10+expanded.ordinality) position
  FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(value)='array' THEN value ELSE '[]'::jsonb END) WITH ORDINALITY entry(scope,ordinality)
  CROSS JOIN LATERAL unnest(CASE
    WHEN entry.scope='jobs:read' THEN ARRAY['triggers:read']
    WHEN entry.scope='jobs:write' THEN ARRAY['triggers:write']
    WHEN expand_legacy AND entry.scope='flows:read' THEN ARRAY['team:read','triggers:read','integrations:read']
    WHEN expand_legacy AND entry.scope='flows:write' THEN ARRAY['team:write','triggers:write','integrations:write']
    WHEN expand_legacy AND entry.scope='runs:write' THEN ARRAY['runs:read','runs:invoke','runs:cancel','runs:write']
    ELSE ARRAY[entry.scope] END) WITH ORDINALITY expanded(scope,ordinality)
  GROUP BY expanded.scope
) scopes
$$;
DO $$
DECLARE field record;
BEGIN
  FOR field IN SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema='app' AND data_type='jsonb' AND column_name IN ('scopes','run_scopes','disabled_scopes')
  LOOP
    EXECUTE format('UPDATE app.%I SET %I=app.canonical_scope_array(%I,%L)',field.table_name,field.column_name,field.column_name,field.column_name<>'disabled_scopes');
  END LOOP;
END $$;
UPDATE app.triggers SET execution_config=jsonb_set(execution_config,'{runScopes}',app.canonical_scope_array(execution_config->'runScopes')) WHERE execution_config ? 'runScopes';
UPDATE app.runs SET execution_config=jsonb_set(execution_config,'{runScopes}',app.canonical_scope_array(execution_config->'runScopes')) WHERE execution_config ? 'runScopes';
UPDATE app.team_settings SET run_defaults=jsonb_set(run_defaults,'{runScopes}',app.canonical_scope_array(run_defaults->'runScopes')) WHERE run_defaults ? 'runScopes';
ALTER TABLE app.triggers ALTER COLUMN run_scopes SET DEFAULT '["team:read","triggers:read","runs:read","integrations:read","skills:read","runs:invoke"]'::jsonb;
DROP FUNCTION app.canonical_scope_array(jsonb,boolean);
DROP FUNCTION app.canonical_trigger_name(text);
INSERT INTO app.schema_migrations(version) VALUES ('0069_triggers_and_events') ON CONFLICT DO NOTHING;
