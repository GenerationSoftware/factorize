-- Independent blob receipts survive run deletion until object cleanup confirms.
CREATE TABLE app.run_media (
 tenant_id uuid NOT NULL,
 id uuid NOT NULL,
 owner_user_id uuid NOT NULL,
 owner_run_id uuid,
 idempotency_key text NOT NULL,
 media_type text NOT NULL,
 byte_size bigint NOT NULL CHECK(byte_size BETWEEN 1 AND 33554432),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','uploading','ready','deleting','deleted')),
 object_key text,
 lease_id uuid,
 lease_expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id),
 UNIQUE(tenant_id,owner_user_id,idempotency_key)
);
CREATE TABLE app.run_media_links (
 tenant_id uuid NOT NULL,run_id uuid NOT NULL,media_id uuid NOT NULL,
 role text NOT NULL CHECK(role IN ('input','scratch')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,run_id,media_id),
 FOREIGN KEY(tenant_id,run_id) REFERENCES app.runs(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,media_id) REFERENCES app.run_media(tenant_id,id)
);
CREATE TABLE app.media_upload_attempts (
 tenant_id uuid NOT NULL,media_id uuid NOT NULL,id uuid NOT NULL,
 object_key text NOT NULL UNIQUE,
 state text NOT NULL DEFAULT 'writing' CHECK(state IN ('writing','adopted','cleanup','deleted')),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,media_id,id)
);
CREATE INDEX run_media_cleanup ON app.run_media(state,updated_at);
CREATE INDEX media_attempt_cleanup ON app.media_upload_attempts(state,expires_at);
INSERT INTO app.schema_migrations(version) VALUES('0076_run_media') ON CONFLICT DO NOTHING;
