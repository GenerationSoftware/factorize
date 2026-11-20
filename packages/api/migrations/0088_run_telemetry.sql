CREATE TABLE app.run_telemetry_spans (
 tenant_id uuid NOT NULL,
 run_id uuid NOT NULL,
 span_key text NOT NULL,
 trace_id text NOT NULL,
 span_id text NOT NULL,
 parent_span_id text,
 kind text NOT NULL,
 name text NOT NULL,
 started_at timestamptz NOT NULL DEFAULT now(),
 ended_at timestamptz,
 status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','ok','error','canceled','uncertain')),
 encrypted_attributes text NOT NULL,
 encrypted_otel text,
 input_tokens bigint,
 output_tokens bigint,
 cache_read_tokens bigint,
 cache_write_tokens bigint,
 reasoning_tokens bigint,
 model text,
 cost_usd numeric,
 encrypted_pricing text,
 PRIMARY KEY(tenant_id,run_id,span_key),
 UNIQUE(tenant_id,run_id,span_id),
 FOREIGN KEY(tenant_id,run_id) REFERENCES app.runs(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE app.run_telemetry_content (
 tenant_id uuid NOT NULL,
 run_id uuid NOT NULL,
 span_key text NOT NULL,
 field text NOT NULL CHECK(field IN ('input','output')),
 chunk integer NOT NULL,
 encrypted_content text NOT NULL,
 PRIMARY KEY(tenant_id,run_id,span_key,field,chunk),
 FOREIGN KEY(tenant_id,run_id,span_key) REFERENCES app.run_telemetry_spans(tenant_id,run_id,span_key) ON DELETE CASCADE
);
CREATE INDEX run_telemetry_page ON app.run_telemetry_spans(tenant_id,run_id,started_at,span_key);
INSERT INTO app.schema_migrations(version) VALUES ('0088_run_telemetry') ON CONFLICT DO NOTHING;
