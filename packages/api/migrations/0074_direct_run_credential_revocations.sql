-- Direct and retained runs have no required Trigger parent. Disconnection must
-- permanently revoke their accepted integration snapshots as well.
ALTER TABLE app.run_credential_revocations DROP CONSTRAINT run_credential_revocations_kind_check;
ALTER TABLE app.run_credential_revocations ADD CONSTRAINT run_credential_revocations_kind_check
  CHECK(kind IN ('bearer','model','github','linear','x','exe','fly','amp','clickup'));
CREATE OR REPLACE FUNCTION app.revoke_selected_run_credential(owner_tenant uuid, credential_kind text, selected_id text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO app.run_credential_revocations(tenant_id,run_id,kind,credential_id)
  SELECT r.tenant_id,r.id,credential_kind,selected_id
  FROM app.runs r JOIN app.trigger_runs j ON j.tenant_id=r.tenant_id AND j.id=r.id
  WHERE r.tenant_id=owner_tenant AND j.state IN ('queued','reserved','starting','running','blocked','stopping')
    AND (CASE credential_kind
      WHEN 'bearer' THEN coalesce(r.execution_config->'portableIntegrationIds','[]'::jsonb) @> jsonb_build_array(selected_id)
      WHEN 'model' THEN r.execution_config->>'modelAccountId'=selected_id
      WHEN 'github' THEN CASE WHEN selected_id ~ '^[0-9]+$' THEN coalesce(r.execution_config->'githubInstallationIds','[]'::jsonb) @> jsonb_build_array(selected_id::numeric) ELSE false END
      WHEN 'linear' THEN r.execution_config->>'linearConnectionId'='linear'
      WHEN 'x' THEN coalesce(r.execution_config->'xConnectionIds','[]'::jsonb) @> jsonb_build_array(selected_id)
      ELSE false END OR EXISTS(SELECT 1 FROM app.agent_integrations i WHERE i.tenant_id=r.tenant_id AND i.kind=credential_kind AND i.credential_id=selected_id
        AND coalesce(r.execution_config->'agentIntegrationIds','[]'::jsonb) @> jsonb_build_array(i.id::text)))
  ON CONFLICT DO NOTHING;
$$;
CREATE OR REPLACE FUNCTION app.revoke_disconnected_agent_integration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (OLD.available AND NOT NEW.available) THEN
    PERFORM app.revoke_selected_run_credential(OLD.tenant_id,OLD.kind,OLD.credential_id);
    -- An AFTER DELETE cannot look the integration ID up again.
    INSERT INTO app.run_credential_revocations(tenant_id,run_id,kind,credential_id)
      SELECT r.tenant_id,r.id,OLD.kind,OLD.credential_id FROM app.runs r JOIN app.trigger_runs j ON j.tenant_id=r.tenant_id AND j.id=r.id
      WHERE r.tenant_id=OLD.tenant_id AND j.state IN ('queued','reserved','starting','running','blocked','stopping')
      AND coalesce(r.execution_config->'agentIntegrationIds','[]'::jsonb) @> jsonb_build_array(OLD.id::text) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS agent_integration_run_revocation ON app.agent_integrations;
CREATE TRIGGER agent_integration_run_revocation AFTER DELETE OR UPDATE OF available ON app.agent_integrations
  FOR EACH ROW EXECUTE FUNCTION app.revoke_disconnected_agent_integration();

-- Backfill missing receipts from live unavailability and retained delete history.
-- Do not revoke a new run for a deletion that preceded its accepted snapshot.
WITH active AS (
  SELECT r.* FROM app.runs r JOIN app.trigger_runs j ON j.tenant_id=r.tenant_id AND j.id=r.id
  WHERE j.state IN ('queued','reserved','starting','running','blocked','stopping')
), selected AS (
  SELECT r.tenant_id,r.id,r.created_at,'bearer'::text kind,v.credential_id FROM active r
  CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(r.execution_config->'portableIntegrationIds')='array' THEN r.execution_config->'portableIntegrationIds' ELSE '[]'::jsonb END) v(credential_id)
  UNION SELECT r.tenant_id,r.id,r.created_at,'model',r.execution_config->>'modelAccountId' FROM active r WHERE r.execution_config->>'modelAccountId' IS NOT NULL
  UNION SELECT r.tenant_id,r.id,r.created_at,'github',v.credential_id FROM active r
  CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(r.execution_config->'githubInstallationIds')='array' THEN r.execution_config->'githubInstallationIds' ELSE '[]'::jsonb END) v(credential_id)
  UNION SELECT r.tenant_id,r.id,r.created_at,'linear','linear' FROM active r WHERE r.execution_config->>'linearConnectionId'='linear'
  UNION SELECT r.tenant_id,r.id,r.created_at,'x',v.credential_id FROM active r
  CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(r.execution_config->'xConnectionIds')='array' THEN r.execution_config->'xConnectionIds' ELSE '[]'::jsonb END) v(credential_id)
  UNION SELECT r.tenant_id,r.id,r.created_at,i.kind,i.credential_id FROM active r JOIN app.agent_integrations i ON i.tenant_id=r.tenant_id
    AND coalesce(r.execution_config->'agentIntegrationIds','[]'::jsonb) @> jsonb_build_array(i.id::text)
)
INSERT INTO app.run_credential_revocations(tenant_id,run_id,kind,credential_id)
SELECT s.tenant_id,s.id,s.kind,s.credential_id FROM selected s WHERE
  (s.kind IN ('bearer','model') AND (NOT EXISTS(SELECT 1 FROM app.integration_records i WHERE i.tenant_id=s.tenant_id AND i.id::text=s.credential_id AND i.kind=s.kind AND i.deleted_at IS NULL)
    OR EXISTS(SELECT 1 FROM app.integration_changes c WHERE c.tenant_id=s.tenant_id AND c.record_id::text=s.credential_id AND c.kind=s.kind AND c.operation='delete' AND c.created_at>=s.created_at)))
  OR (s.kind NOT IN ('bearer','model') AND NOT EXISTS(SELECT 1 FROM app.agent_integrations i WHERE i.tenant_id=s.tenant_id AND i.kind=s.kind AND i.credential_id=s.credential_id AND i.available))
ON CONFLICT DO NOTHING;
INSERT INTO app.schema_migrations(version) VALUES('0074_direct_run_credential_revocations') ON CONFLICT DO NOTHING;
