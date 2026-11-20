CREATE TABLE app.proxy_payloads (
 tenant_id uuid NOT NULL,
 id uuid NOT NULL,
 identity_id uuid NOT NULL,
 owner_user_id uuid NOT NULL,
 name text NOT NULL,
 media_type text NOT NULL,
 declared_size integer,
 size integer NOT NULL DEFAULT 0,
 sha256 text,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','uploading','finalizing','ready')),
 lease_id uuid,
 lease_expires_at timestamptz,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,identity_id) REFERENCES app.agent_identities(tenant_id,id)
);
CREATE TABLE app.proxy_payload_chunks (
 tenant_id uuid NOT NULL,
 payload_id uuid NOT NULL,
 byte_offset integer NOT NULL,
 byte_size integer NOT NULL,
 sha256 text NOT NULL,
 object_key text NOT NULL,
 PRIMARY KEY(tenant_id,payload_id,byte_offset),
 FOREIGN KEY(tenant_id,payload_id) REFERENCES app.proxy_payloads(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX proxy_payload_expiry ON app.proxy_payloads(expires_at);
INSERT INTO app.schema_migrations(version) VALUES ('0087_proxy_payloads') ON CONFLICT DO NOTHING;
