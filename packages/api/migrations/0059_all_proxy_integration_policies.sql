-- All outbound API credentials share the agent integration registry and policy.
-- Tail signing secrets authenticate inbound webhooks and are deliberately excluded.
ALTER TABLE app.agent_integrations DROP CONSTRAINT agent_integrations_kind_check;
ALTER TABLE app.agent_integrations ADD CONSTRAINT agent_integrations_kind_check
 CHECK(kind IN ('bearer','github','linear','model','fly','exe','amp','clickup','x'));

CREATE FUNCTION app.agent_connection_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 t uuid; connection_kind text; k text; c text; n text; d text;
BEGIN
 IF TG_OP='DELETE' THEN t=OLD.tenant_id; connection_kind=OLD.kind;
 ELSE t=NEW.tenant_id; connection_kind=NEW.kind; END IF;
 IF connection_kind IN ('linear','clickup') THEN
  k=connection_kind; c=connection_kind;
  n=CASE k WHEN 'linear' THEN 'Linear' ELSE 'ClickUp' END;
  d=CASE k WHEN 'linear' THEN 'Linear GraphQL API' ELSE 'ClickUp API' END;
 ELSIF connection_kind LIKE 'exe:%' THEN
  k='exe'; c=substring(connection_kind FROM 5); n='exe.dev · '||c; d='exe.dev account API';
 ELSIF connection_kind LIKE 'amp:%' THEN
  k='amp'; c=substring(connection_kind FROM 5); n='Amp · '||c; d='Amp project API';
 ELSE RETURN NULL;
 END IF;
 PERFORM app.sync_agent_integration(t,k,c,n,d,TG_OP<>'DELETE');
 RETURN NULL;
END;
$$;
DROP TRIGGER agent_linear_sync ON app.connections;
CREATE TRIGGER agent_connection_sync AFTER INSERT OR UPDATE OR DELETE ON app.connections
 FOR EACH ROW EXECUTE FUNCTION app.agent_connection_changed();

CREATE FUNCTION app.agent_fly_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  PERFORM app.sync_agent_integration(OLD.tenant_id,'fly','fly','Fly.io · '||OLD.organization_name,'Fly Machines API',false);
 ELSE
  -- Switching organizations revokes prior approvals, just like disconnecting.
  IF TG_OP='UPDATE' AND OLD.organization_slug<>NEW.organization_slug THEN
   PERFORM app.sync_agent_integration(OLD.tenant_id,'fly','fly','Fly.io · '||OLD.organization_name,'Fly Machines API',false);
  END IF;
  PERFORM app.sync_agent_integration(NEW.tenant_id,'fly','fly','Fly.io · '||NEW.organization_name,'Fly Machines API',true);
 END IF;
 RETURN NULL;
END;
$$;
CREATE TRIGGER agent_fly_sync AFTER INSERT OR UPDATE OR DELETE ON app.fly_connections
 FOR EACH ROW EXECUTE FUNCTION app.agent_fly_changed();

INSERT INTO app.agent_integrations(tenant_id,kind,credential_id,name,description,available)
 SELECT tenant_id,
  CASE WHEN kind='clickup' THEN 'clickup' WHEN kind LIKE 'exe:%' THEN 'exe' ELSE 'amp' END,
  CASE WHEN kind='clickup' THEN kind ELSE substring(kind FROM 5) END,
  CASE WHEN kind='clickup' THEN 'ClickUp' WHEN kind LIKE 'exe:%' THEN 'exe.dev · '||substring(kind FROM 5) ELSE 'Amp · '||substring(kind FROM 5) END,
  CASE WHEN kind='clickup' THEN 'ClickUp API' WHEN kind LIKE 'exe:%' THEN 'exe.dev account API' ELSE 'Amp project API' END,true
 FROM app.connections WHERE kind='clickup' OR kind LIKE 'exe:%' OR kind LIKE 'amp:%';
INSERT INTO app.agent_integrations(tenant_id,kind,credential_id,name,description,available)
 SELECT tenant_id,'fly','fly','Fly.io · '||organization_name,'Fly Machines API',true FROM app.fly_connections;
CREATE FUNCTION app.agent_x_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  PERFORM app.sync_agent_integration(OLD.tenant_id,'x',OLD.id::text,'X · '||OLD.name,'X API v2',false);
 ELSE
  PERFORM app.sync_agent_integration(NEW.tenant_id,'x',NEW.id::text,'X · '||NEW.name,'X API v2',NEW.status='connected');
 END IF;
 RETURN NULL;
END;
$$;
CREATE TRIGGER agent_x_sync AFTER INSERT OR UPDATE OR DELETE ON app.x_connections
 FOR EACH ROW EXECUTE FUNCTION app.agent_x_changed();
INSERT INTO app.agent_integrations(tenant_id,kind,credential_id,name,description,available)
 SELECT tenant_id,'x',id::text,'X · '||name,'X API v2',status='connected' FROM app.x_connections;
INSERT INTO app.schema_migrations(version) VALUES ('0059_all_proxy_integration_policies') ON CONFLICT DO NOTHING;
