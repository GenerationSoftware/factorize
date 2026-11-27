-- Client grants follow the stable integration; already queued operations and
-- VM-provider identities must not follow a credential boundary.
ALTER TABLE app.agent_integrations ADD COLUMN operation_epoch integer;
UPDATE app.agent_integrations SET operation_epoch=epoch;
ALTER TABLE app.agent_integrations
  ALTER COLUMN operation_epoch SET DEFAULT 1,
  ALTER COLUMN operation_epoch SET NOT NULL,
  ADD CHECK (operation_epoch >= epoch);

CREATE OR REPLACE FUNCTION app.sync_agent_integration(t uuid,k text,c text,n text,d text,a boolean)
RETURNS void LANGUAGE sql AS $$
 INSERT INTO app.agent_integrations(tenant_id,kind,credential_id,name,description,available)
 VALUES(t,k,c,n,d,a)
 ON CONFLICT(tenant_id,kind,credential_id) DO UPDATE SET
   name=excluded.name,description=excluded.description,available=excluded.available,
   operation_epoch=app.agent_integrations.operation_epoch+
     CASE WHEN app.agent_integrations.available AND NOT excluded.available THEN 1 ELSE 0 END,
   revision=app.agent_integrations.revision+1;
$$;

-- Incrementing the authorization epoch always invalidates existing work too.
-- Trigger name sorts after agent_policy_revocation, which increments epoch on disable.
CREATE FUNCTION app.fence_agent_integration_operations() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'INSERT' THEN
  NEW.operation_epoch = greatest(NEW.operation_epoch, NEW.epoch);
 ELSIF NEW.epoch > OLD.epoch THEN
  NEW.operation_epoch = greatest(NEW.operation_epoch, OLD.operation_epoch + 1, NEW.epoch);
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER zz_agent_operation_fence BEFORE INSERT OR UPDATE ON app.agent_integrations
 FOR EACH ROW EXECUTE FUNCTION app.fence_agent_integration_operations();

-- Actual provider removal is not a temporary reconnect or loss of availability.
-- The existing sync triggers mark the registration inactive before this trigger.
CREATE FUNCTION app.revoke_removed_agent_integration() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k text; c text;
BEGIN
 CASE TG_TABLE_NAME
 WHEN 'integration_records' THEN
  IF TG_OP = 'UPDATE' AND (OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL) THEN RETURN NULL; END IF;
  k=OLD.kind; c=OLD.id::text;
 WHEN 'github_installations' THEN k='github'; c=OLD.installation_id::text;
 WHEN 'fly_connections' THEN k='fly'; c='fly';
 WHEN 'x_connections' THEN
  IF TG_OP = 'UPDATE' AND (OLD.status='revoked' OR NEW.status<>'revoked') THEN RETURN NULL; END IF;
  k='x'; c=OLD.id::text;
 WHEN 'connections' THEN
  IF OLD.kind IN ('linear','clickup') THEN
   k=OLD.kind; c=k;
  ELSIF OLD.kind LIKE 'exe:%' OR OLD.kind LIKE 'amp:%' THEN
   k=split_part(OLD.kind,':',1); c=substring(OLD.kind FROM 5);
  ELSE RETURN NULL;
  END IF;
 END CASE;
 UPDATE app.agent_integrations SET epoch=epoch+1
  WHERE tenant_id=OLD.tenant_id AND kind=k AND credential_id=c;
 RETURN NULL;
END;
$$;
CREATE TRIGGER zz_agent_integration_removed AFTER DELETE OR UPDATE OF deleted_at ON app.integration_records
 FOR EACH ROW EXECUTE FUNCTION app.revoke_removed_agent_integration();
CREATE TRIGGER zz_agent_github_removed AFTER DELETE ON app.github_installations
 FOR EACH ROW EXECUTE FUNCTION app.revoke_removed_agent_integration();
CREATE TRIGGER zz_agent_fly_removed AFTER DELETE ON app.fly_connections
 FOR EACH ROW EXECUTE FUNCTION app.revoke_removed_agent_integration();
CREATE TRIGGER zz_agent_x_removed AFTER DELETE OR UPDATE OF status ON app.x_connections
 FOR EACH ROW EXECUTE FUNCTION app.revoke_removed_agent_integration();
CREATE TRIGGER zz_agent_connection_removed AFTER DELETE ON app.connections
 FOR EACH ROW EXECUTE FUNCTION app.revoke_removed_agent_integration();
