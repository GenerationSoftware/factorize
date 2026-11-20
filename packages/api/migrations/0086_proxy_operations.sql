CREATE TABLE app.proxy_operations (
 tenant_id uuid NOT NULL,
 id uuid NOT NULL,
 identity_id uuid NOT NULL,
 integration_id uuid NOT NULL,
 integration_epoch integer NOT NULL,
 idempotency_key text NOT NULL,
 encrypted_request text NOT NULL,
 encrypted_auth text NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','complete','failed','canceled','uncertain')),
 status integer,
 headers jsonb NOT NULL DEFAULT '{}',
 size integer NOT NULL DEFAULT 0,
 error_code text,
 error_message text,
 effects_uncertain boolean NOT NULL DEFAULT false,
 started_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',
 PRIMARY KEY(tenant_id,id),
 UNIQUE(tenant_id,identity_id,idempotency_key),
 FOREIGN KEY(tenant_id,identity_id) REFERENCES app.agent_identities(tenant_id,id),
 FOREIGN KEY(tenant_id,integration_id) REFERENCES app.agent_integrations(tenant_id,id)
);
CREATE INDEX proxy_operations_pending ON app.proxy_operations(state,updated_at) WHERE state IN ('queued','running');
INSERT INTO app.schema_migrations(version) VALUES ('0086_proxy_operations') ON CONFLICT DO NOTHING;
