-- Keep old ciphertext and all old links as migration provenance. No historical
-- run, skill body, supporting file, or accepted skill snapshot is discarded.
ALTER TABLE app.triggers ADD COLUMN encrypted_prompt text,
  ADD COLUMN context_version integer NOT NULL DEFAULT 2,
  ADD COLUMN context_review_required boolean NOT NULL DEFAULT false;
UPDATE app.triggers SET context_version=1;
ALTER TABLE app.triggers ALTER COLUMN encrypted_prompt_template SET DEFAULT '';
ALTER TABLE app.events ADD COLUMN encrypted_template text,
  ADD COLUMN legacy_template boolean NOT NULL DEFAULT false;
UPDATE app.events e SET encrypted_template=t.encrypted_prompt_template,legacy_template=true
  FROM app.triggers t WHERE t.tenant_id=e.tenant_id AND t.id=e.trigger_id
    AND COALESCE(t.execution_config->>'executionType','agent')='agent';

CREATE TABLE app.legacy_trigger_skill_links AS SELECT * FROM app.trigger_skills;
ALTER TABLE app.legacy_trigger_skill_links ADD FOREIGN KEY(tenant_id) REFERENCES app.tenants(id) ON DELETE CASCADE;
CREATE TEMP TABLE context_skill_cutover ON COMMIT DROP AS
SELECT t.tenant_id,t.id,COALESCE(t.execution_config->>'launchSkillId',
  (SELECT skill_id::text FROM app.trigger_skills s WHERE s.tenant_id=t.tenant_id AND s.trigger_id=t.id ORDER BY position,skill_id LIMIT 1)) skill_id,
  (SELECT count(DISTINCT value) FROM (
    SELECT skill_id::text value FROM app.trigger_skills s WHERE s.tenant_id=t.tenant_id AND s.trigger_id=t.id
    UNION SELECT t.execution_config->>'launchSkillId' WHERE t.execution_config ? 'launchSkillId'
  ) selected) skill_count
FROM app.triggers t;
INSERT INTO app.configuration_diagnostics(tenant_id,resource_kind,resource_id,code,details)
SELECT tenant_id,'trigger',id,'multiple_skills_require_review',jsonb_build_object('skillCount',skill_count,'message','Select one skill before enabling this Trigger. Original links are retained.')
FROM context_skill_cutover WHERE skill_count>1;
UPDATE app.triggers t SET enabled=CASE WHEN c.skill_count>1 THEN false ELSE t.enabled END,
  context_review_required=c.skill_count>1,
  execution_config=(t.execution_config-'launchSkillId') || CASE WHEN c.skill_id IS NOT NULL THEN jsonb_build_object('skillId',c.skill_id) ELSE '{}'::jsonb END
FROM context_skill_cutover c WHERE c.tenant_id=t.tenant_id AND c.id=t.id;
UPDATE app.runs SET execution_config=(execution_config-'launchSkillId')||jsonb_build_object('skillId',execution_config->'launchSkillId') WHERE execution_config ? 'launchSkillId';
DELETE FROM app.trigger_skills;
INSERT INTO app.trigger_skills(tenant_id,trigger_id,skill_id,position,context_skill)
SELECT c.tenant_id,c.id,c.skill_id::uuid,0,false FROM context_skill_cutover c
JOIN app.skills s ON s.tenant_id=c.tenant_id AND s.id=c.skill_id::uuid WHERE c.skill_id IS NOT NULL;
CREATE UNIQUE INDEX trigger_one_skill ON app.trigger_skills(tenant_id,trigger_id);
INSERT INTO app.schema_migrations(version) VALUES('0072_single_skill_event_context') ON CONFLICT DO NOTHING;
