CREATE TABLE app.ghcr_connections (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  image text NOT NULL,
  username text NOT NULL,
  encrypted_token text NOT NULL,
  revision integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,image)
);

ALTER TABLE app.agent_integrations DROP CONSTRAINT agent_integrations_kind_check;
ALTER TABLE app.agent_integrations ADD CONSTRAINT agent_integrations_kind_check
  CHECK (kind IN ('bearer','github','linear','fly','exe','amp','clickup','x','cloudflare','hetzner','ghcr'));

CREATE FUNCTION app.agent_ghcr_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  PERFORM app.sync_agent_integration(OLD.tenant_id,'ghcr',OLD.id::text,'GitHub Container Registry · '||OLD.image,'GHCR image metadata',false);
  UPDATE app.agent_integrations SET epoch=epoch+1 WHERE tenant_id=OLD.tenant_id AND kind='ghcr' AND credential_id=OLD.id::text;
 ELSE
  PERFORM app.sync_agent_integration(NEW.tenant_id,'ghcr',NEW.id::text,'GitHub Container Registry · '||NEW.image,'GHCR image metadata',true);
  IF TG_OP='UPDATE' THEN
   UPDATE app.agent_integrations SET operation_epoch=operation_epoch+1 WHERE tenant_id=NEW.tenant_id AND kind='ghcr' AND credential_id=NEW.id::text;
  END IF;
 END IF;
 RETURN NULL;
END;
$$;
CREATE TRIGGER agent_ghcr_sync AFTER INSERT OR UPDATE OR DELETE ON app.ghcr_connections
 FOR EACH ROW EXECUTE FUNCTION app.agent_ghcr_changed();
