-- Preserve existing rows, but require fresh consent for the new proxy contract.
UPDATE app.agent_integrations i SET available=false,epoch=i.epoch+1,revision=i.revision+1
  FROM app.cloudflare_connections c
  WHERE i.tenant_id=c.tenant_id AND i.kind='cloudflare' AND i.credential_id=c.id::text;
ALTER TABLE app.cloudflare_connections ALTER COLUMN account_id DROP NOT NULL;
ALTER TABLE app.cloudflare_connections DROP COLUMN write_enabled;
CREATE UNIQUE INDEX cloudflare_broker_connection ON app.cloudflare_connections(tenant_id) WHERE account_id IS NULL;
DELETE FROM app.cloudflare_oauth_attempts;
ALTER TABLE app.cloudflare_oauth_attempts DROP COLUMN scopes, DROP COLUMN write_requested, DROP COLUMN encrypted_pending;
