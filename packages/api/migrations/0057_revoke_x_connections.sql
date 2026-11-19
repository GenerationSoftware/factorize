ALTER TABLE app.x_connections DROP CONSTRAINT x_connections_status_check;
ALTER TABLE app.x_connections ADD CONSTRAINT x_connections_status_check
  CHECK (status IN ('pending','connected','reconnect_required','revoked'));
DROP INDEX app.x_connections_tenant_name_ci;
CREATE UNIQUE INDEX x_connections_tenant_name_ci
  ON app.x_connections(tenant_id,lower(name)) WHERE status <> 'revoked';
INSERT INTO app.schema_migrations(version) VALUES ('0057_revoke_x_connections') ON CONFLICT DO NOTHING;
