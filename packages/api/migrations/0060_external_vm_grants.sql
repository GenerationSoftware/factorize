ALTER TABLE app.agent_identities DROP CONSTRAINT agent_identities_kind_check;
ALTER TABLE app.agent_identities ADD CHECK(kind IN ('oauth','run','vm'));
CREATE TABLE app.vm_grants (
 tenant_id uuid NOT NULL, id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 parent_id uuid NOT NULL, provider_id uuid NOT NULL, provider_epoch integer NOT NULL,
 vm text NOT NULL, permissions jsonb NOT NULL, parent_scopes jsonb NOT NULL,
 request_key text NOT NULL, issuer text, subject text, proof_hash text,
 expires_at timestamptz NOT NULL, revoked_at timestamptz, cleaned_at timestamptz, cleanup_after timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,parent_id,request_key),
 FOREIGN KEY(tenant_id,parent_id) REFERENCES app.agent_identities(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,provider_id) REFERENCES app.agent_integrations(tenant_id,id)
);
CREATE INDEX vm_grant_cleanup ON app.vm_grants(expires_at) WHERE cleaned_at IS NULL;
INSERT INTO app.schema_migrations(version) VALUES ('0060_external_vm_grants');
