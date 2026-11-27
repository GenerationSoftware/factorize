ALTER TABLE app.agent_integrations DROP CONSTRAINT agent_integrations_kind_check;
ALTER TABLE app.agent_integrations ADD CONSTRAINT agent_integrations_kind_check
  CHECK (kind IN ('bearer','github','linear','fly','exe','amp','clickup','x','cloudflare','ghcr','hetzner'));

CREATE FUNCTION app.sync_hetzner_client_permission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  UPDATE app.agent_integrations SET available=false,policy='requestable',epoch=epoch+1,revision=revision+1
    WHERE tenant_id=OLD.tenant_id AND kind='hetzner' AND credential_id='hetzner';
 ELSE
  PERFORM app.sync_agent_integration(NEW.tenant_id,'hetzner','hetzner','Hetzner Cloud',
    'Read inventory and check SSH authentication on owner-enrolled servers',true);
 END IF;
 RETURN NULL;
END;
$$;
CREATE TRIGGER hetzner_client_permission_saved AFTER INSERT OR UPDATE ON app.connections
 FOR EACH ROW WHEN (NEW.kind='hetzner') EXECUTE FUNCTION app.sync_hetzner_client_permission();
CREATE TRIGGER hetzner_client_permission_deleted AFTER DELETE ON app.connections
 FOR EACH ROW WHEN (OLD.kind='hetzner') EXECUTE FUNCTION app.sync_hetzner_client_permission();

-- Existing projects get a checkbox, not a grant. Old per-server selections
-- must not implicitly give those clients access to every enrolled server.
INSERT INTO app.agent_integrations(tenant_id,kind,credential_id,name,description,available,policy)
 SELECT tenant_id,'hetzner','hetzner','Hetzner Cloud','Read inventory and check SSH authentication on owner-enrolled servers',true,'requestable'
 FROM app.connections WHERE kind='hetzner'
 ON CONFLICT (tenant_id,kind,credential_id) DO NOTHING;
