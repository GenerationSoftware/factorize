-- Disconnect/suspension is permanent for existing run selections. Reconnecting
-- a provider slot or reusing an integration UUID must not restore old grants.
CREATE TABLE app.run_credential_revocations (
  tenant_id uuid NOT NULL,
  run_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('bearer','model','github','linear')),
  credential_id text NOT NULL,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,run_id,kind,credential_id),
  FOREIGN KEY (tenant_id,run_id) REFERENCES app.job_runs(tenant_id,id) ON DELETE CASCADE
);

CREATE FUNCTION app.revoke_selected_run_credential(owner_tenant uuid, credential_kind text, selected_id text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO app.run_credential_revocations(tenant_id,run_id,kind,credential_id)
  SELECT r.tenant_id,r.id,credential_kind,selected_id
  FROM app.runs r JOIN app.job_runs j ON j.tenant_id=r.tenant_id AND j.id=r.id
  JOIN app.jobs job ON job.tenant_id=j.tenant_id AND job.id=j.job_id
  JOIN app.tenants t ON t.id=r.tenant_id
  WHERE r.tenant_id=owner_tenant AND j.state IN ('queued','reserved','starting','running','blocked','stopping')
    AND CASE credential_kind
      WHEN 'bearer' THEN coalesce(r.execution_config->'portableIntegrationIds','[]'::jsonb) @> jsonb_build_array(selected_id)
      WHEN 'model' THEN r.execution_config->>'modelAccess'='portable' AND r.execution_config->>'modelAccountId'=selected_id
      WHEN 'github' THEN coalesce(r.execution_config->'githubInstallationIds','[]'::jsonb) @> jsonb_build_array(selected_id::bigint)
      WHEN 'linear' THEN r.execution_config->>'linearConnectionId'='linear'
      ELSE false END
  ON CONFLICT DO NOTHING;
$$;

CREATE FUNCTION app.revoke_disconnected_integration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
    PERFORM app.revoke_selected_run_credential(OLD.tenant_id,OLD.kind,OLD.id::text);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER integration_run_revocation AFTER DELETE OR UPDATE OF deleted_at ON app.integration_records
  FOR EACH ROW EXECUTE FUNCTION app.revoke_disconnected_integration();

CREATE FUNCTION app.revoke_disconnected_github() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (OLD.state='active' AND NEW.state<>'active') THEN
    PERFORM app.revoke_selected_run_credential(OLD.tenant_id,'github',OLD.installation_id::text);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER github_run_revocation AFTER DELETE OR UPDATE OF state ON app.github_installations
  FOR EACH ROW EXECUTE FUNCTION app.revoke_disconnected_github();

CREATE FUNCTION app.revoke_disconnected_connection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.kind='linear' THEN
    PERFORM app.revoke_selected_run_credential(OLD.tenant_id,'linear','linear');
  ELSIF OLD.kind LIKE 'exe:%' THEN
    UPDATE app.vendor_run_identity_bindings b SET revoked_at=coalesce(b.revoked_at,now()),updated_at=now()
    FROM app.runs r WHERE b.tenant_id=OLD.tenant_id AND b.provider='exe.dev'
      AND r.tenant_id=b.tenant_id AND r.id=b.run_id AND r.execution_config->>'connectionId'=substring(OLD.kind FROM 5);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER connection_run_revocation AFTER DELETE ON app.connections
  FOR EACH ROW EXECUTE FUNCTION app.revoke_disconnected_connection();

CREATE FUNCTION app.revoke_disconnected_fly() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.organization_slug IS DISTINCT FROM NEW.organization_slug THEN
    UPDATE app.vendor_run_identity_bindings SET revoked_at=coalesce(revoked_at,now()),updated_at=now()
      WHERE tenant_id=OLD.tenant_id AND provider='fly.io';
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER fly_run_revocation AFTER DELETE OR UPDATE OF organization_slug ON app.fly_connections
  FOR EACH ROW EXECUTE FUNCTION app.revoke_disconnected_fly();

INSERT INTO app.schema_migrations(version) VALUES ('0049_run_credential_revocations') ON CONFLICT DO NOTHING;
