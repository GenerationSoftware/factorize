ALTER TABLE app.skills ADD COLUMN legacy_context jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE app.skills ADD COLUMN migration_pending boolean NOT NULL DEFAULT false;
DO $$
DECLARE item record; new_id uuid; chosen text; suffix integer; contexts jsonb;
BEGIN
  FOR item IN SELECT * FROM app.triggers t ORDER BY tenant_id,id LOOP
    new_id:=gen_random_uuid(); suffix:=0;
    chosen:=left(item.slug,43)||'-skill-'||left(replace(new_id::text,'-',''),12);
    WHILE EXISTS(SELECT 1 FROM app.resource_names WHERE tenant_id=item.tenant_id AND name=chosen) LOOP
      suffix:=suffix+1; chosen:=left(item.slug,39)||'-skill-'||left(replace(new_id::text,'-',''),12)||'-'||suffix;
    END LOOP;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('key',s.key,'encrypted_body',s.encrypted_body,'encrypted_directory',s.encrypted_directory,'artifact_version',s.artifact_version) ORDER BY ts.position),'[]'::jsonb)
      INTO contexts FROM (
        SELECT skill_id,position FROM app.trigger_skills WHERE tenant_id=item.tenant_id AND trigger_id=item.id
        UNION
        SELECT skill_id,position FROM app.legacy_trigger_skill_links WHERE tenant_id=item.tenant_id AND trigger_id=item.id AND item.context_review_required
      ) ts JOIN app.skills s ON s.tenant_id=item.tenant_id AND s.id=ts.skill_id;
    INSERT INTO app.skills(tenant_id,id,key,encrypted_body,encrypted_script,run_defaults,legacy_context,migration_pending)
      VALUES(item.tenant_id,new_id,chosen,COALESCE(item.encrypted_prompt,''),NULL,
        jsonb_strip_nulls(jsonb_build_object(
          'executionType',COALESCE(item.execution_config->>'executionType','agent'),
          'requiresVm',COALESCE((item.execution_config->>'requiresVm')::boolean,COALESCE(item.execution_config->>'executionType'='code',false) OR COALESCE(item.execution_config->>'connectionId'<>'',false)),
          'executionConfigId',NULLIF(item.execution_config->>'connectionId',''),
          'vmImage',item.execution_config->>'image','model',item.model,'effort',item.effort,'tags',item.tags,
          'modelAccountId',item.execution_config->>'modelAccountId','runScopes',item.run_scopes,
          'portableIntegrationIds',COALESCE(item.execution_config->'portableIntegrationIds','[]'::jsonb),
          'githubInstallationIds',COALESCE(item.execution_config->'githubInstallationIds','[]'::jsonb),
          'linearConnectionId',item.execution_config->>'linearConnectionId','xConnectionIds',COALESCE(item.execution_config->'xConnectionIds','[]'::jsonb),
          'concurrencyLimit',item.concurrency_limit,
          'allowedTriggerIds',(SELECT COALESCE(jsonb_agg(destination_trigger_id),'[]'::jsonb) FROM app.manual_invocation_permissions WHERE tenant_id=item.tenant_id AND source_trigger_id=item.id)
        )),contexts,true);
    -- Scripts remain in the original execution projection until a settings save
    -- encrypts them into the skill setting. No plaintext script is newly persisted.
    INSERT INTO app.configuration_diagnostics(tenant_id,resource_kind,resource_id,code,details)
      VALUES(item.tenant_id,'trigger',item.id,'skill_owned_migration',jsonb_build_object('skillId',new_id,'previousName',item.name,'previousPrompt',item.encrypted_prompt,'previousExecutionConfig',item.execution_config));
    DELETE FROM app.trigger_skills WHERE tenant_id=item.tenant_id AND trigger_id=item.id;
    INSERT INTO app.trigger_skills(tenant_id,trigger_id,skill_id,position,context_skill,skill_owned) VALUES(item.tenant_id,item.id,new_id,0,false,true);
    UPDATE app.triggers SET encrypted_prompt='',execution_config=execution_config||jsonb_build_object('skillId',new_id) WHERE tenant_id=item.tenant_id AND id=item.id;
  END LOOP;
END $$;
DROP INDEX app.one_owned_trigger_per_skill;
CREATE UNIQUE INDEX one_trigger_per_skill ON app.trigger_skills(tenant_id,skill_id);
INSERT INTO app.schema_migrations(version) VALUES ('0084_migrate_trigger_skills') ON CONFLICT DO NOTHING;
