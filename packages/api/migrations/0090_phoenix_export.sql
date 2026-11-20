CREATE TABLE app.phoenix_integrations (
 tenant_id uuid PRIMARY KEY REFERENCES app.tenants(id) ON DELETE CASCADE,
 endpoint text NOT NULL,
 project_name text NOT NULL,
 project_id text,
 encrypted_key text NOT NULL,
 enabled boolean NOT NULL DEFAULT true,
 enabled_since timestamptz NOT NULL DEFAULT now(),
 revision integer NOT NULL DEFAULT 1,
 last_test_at timestamptz,
 last_error text
);
CREATE TABLE app.phoenix_span_exports (
 tenant_id uuid NOT NULL,
 run_id uuid NOT NULL,
 span_key text NOT NULL,
 integration_revision integer NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','failed','canceled')),
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_id uuid,
 lease_expires_at timestamptz,
 last_error text,
 PRIMARY KEY(tenant_id,run_id,span_key),
 FOREIGN KEY(tenant_id,run_id,span_key) REFERENCES app.run_telemetry_spans(tenant_id,run_id,span_key) ON DELETE CASCADE
);
CREATE INDEX phoenix_export_pending ON app.phoenix_span_exports(next_attempt_at,lease_expires_at) WHERE state IN ('pending','sending');
CREATE TABLE app.phoenix_run_links (
 tenant_id uuid NOT NULL,
 run_id uuid NOT NULL,
 endpoint text NOT NULL,
 project_name text NOT NULL,
 project_id text,
 trace_id text NOT NULL,
 PRIMARY KEY(tenant_id,run_id),
 FOREIGN KEY(tenant_id,run_id) REFERENCES app.runs(tenant_id,id) ON DELETE CASCADE
);
INSERT INTO app.schema_migrations(version) VALUES ('0090_phoenix_export') ON CONFLICT DO NOTHING;
