-- Keep keys attached to saved clients, independent of provider connection lifecycle.
INSERT INTO app.connections (tenant_id, kind, encrypted_value)
SELECT tenant_id, replace(kind, 'hetzner-client-key:', 'ssh-client-key:'), encrypted_value
FROM app.connections WHERE kind LIKE 'hetzner-client-key:%'
ON CONFLICT (tenant_id, kind) DO NOTHING;
