-- Stable references survive disconnects. Epoch scopes cannot revive after a
-- disconnect or disable; credential rotation deliberately retains the epoch.
CREATE TABLE app.agent_integrations (
 tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK(kind IN ('bearer','github','linear','model')),
 credential_id text NOT NULL,
 name text NOT NULL,
 description text,
 available boolean NOT NULL,
 policy text NOT NULL DEFAULT 'requestable' CHECK(policy IN ('baseline','requestable','disabled')),
 epoch integer NOT NULL DEFAULT 1 CHECK(epoch>0),
 revision integer NOT NULL DEFAULT 1,
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,kind,credential_id)
);
CREATE FUNCTION app.sync_agent_integration(t uuid,k text,c text,n text,d text,a boolean) RETURNS void LANGUAGE sql AS $$
 INSERT INTO app.agent_integrations(tenant_id,kind,credential_id,name,description,available) VALUES(t,k,c,n,d,a)
 ON CONFLICT(tenant_id,kind,credential_id) DO UPDATE SET name=excluded.name,description=excluded.description,available=excluded.available,
 epoch=app.agent_integrations.epoch+CASE WHEN app.agent_integrations.available AND NOT excluded.available THEN 1 ELSE 0 END,
 revision=app.agent_integrations.revision+1;
$$;
CREATE FUNCTION app.agent_integration_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='integration_records' THEN
  IF TG_OP='DELETE' THEN
   PERFORM app.sync_agent_integration(OLD.tenant_id,OLD.kind,OLD.id::text,OLD.name,OLD.description,false);
  ELSE
   PERFORM app.sync_agent_integration(NEW.tenant_id,NEW.kind,NEW.id::text,NEW.name,NEW.description,NEW.deleted_at IS NULL);
  END IF;
 ELSIF TG_TABLE_NAME='github_installations' THEN
  IF TG_OP='DELETE' THEN
   PERFORM app.sync_agent_integration(OLD.tenant_id,'github',OLD.installation_id::text,'GitHub · '||OLD.account_login,'GitHub installation API',false);
  ELSE
   PERFORM app.sync_agent_integration(NEW.tenant_id,'github',NEW.installation_id::text,'GitHub · '||NEW.account_login,'GitHub installation API',NEW.state='active');
  END IF;
 ELSE
  IF TG_OP='DELETE' THEN
   IF OLD.kind='linear' THEN PERFORM app.sync_agent_integration(OLD.tenant_id,'linear','linear','Linear','Linear GraphQL API',false); END IF;
  ELSE
   IF NEW.kind='linear' THEN PERFORM app.sync_agent_integration(NEW.tenant_id,'linear','linear','Linear','Linear GraphQL API',true); END IF;
  END IF;
 END IF;
 RETURN NULL;
END;
$$;
CREATE TRIGGER agent_integration_sync AFTER INSERT OR UPDATE OR DELETE ON app.integration_records FOR EACH ROW EXECUTE FUNCTION app.agent_integration_changed();
CREATE TRIGGER agent_github_sync AFTER INSERT OR UPDATE OR DELETE ON app.github_installations FOR EACH ROW EXECUTE FUNCTION app.agent_integration_changed();
CREATE TRIGGER agent_linear_sync AFTER INSERT OR UPDATE OR DELETE ON app.connections FOR EACH ROW EXECUTE FUNCTION app.agent_integration_changed();
INSERT INTO app.agent_integrations(tenant_id,kind,credential_id,name,description,available)
 SELECT tenant_id,kind,id::text,name,description,deleted_at IS NULL FROM app.integration_records;
INSERT INTO app.agent_integrations(tenant_id,kind,credential_id,name,description,available)
 SELECT tenant_id,'github',installation_id::text,'GitHub · '||account_login,'GitHub installation API',state='active' FROM app.github_installations;
INSERT INTO app.agent_integrations(tenant_id,kind,credential_id,name,description,available)
 SELECT tenant_id,'linear','linear','Linear','Linear GraphQL API',true FROM app.connections WHERE kind='linear';
CREATE FUNCTION app.invalidate_agent_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.policy<>NEW.policy THEN
  NEW.revision=OLD.revision+1;
  IF NEW.policy='disabled' THEN NEW.epoch=OLD.epoch+1; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER agent_policy_revocation BEFORE UPDATE OF policy ON app.agent_integrations FOR EACH ROW EXECUTE FUNCTION app.invalidate_agent_policy();
CREATE TABLE app.agent_identities (
 tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK(kind IN ('oauth','run')),
 subject text NOT NULL,
 user_id uuid NOT NULL,
 session_version integer NOT NULL,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,kind,subject)
);
-- Reserve a cleanup receipt before uploading. Failed uploads and interrupted
-- calls leave expiring receipts, so no R2 object can become an orphan.
CREATE TABLE app.agent_proxy_responses (
 tenant_id uuid NOT NULL,
 id uuid NOT NULL,
 identity_id uuid NOT NULL,
 integration_id uuid NOT NULL,
 integration_epoch integer NOT NULL,
 object_key text NOT NULL UNIQUE,
 size integer,
 expires_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,identity_id) REFERENCES app.agent_identities(tenant_id,id),
 FOREIGN KEY(tenant_id,integration_id) REFERENCES app.agent_integrations(tenant_id,id)
);
CREATE INDEX agent_proxy_response_expiry ON app.agent_proxy_responses(expires_at);
INSERT INTO app.schema_migrations(version) VALUES ('0054_agent_api_grants') ON CONFLICT DO NOTHING;
