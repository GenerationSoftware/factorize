-- Projection provenance is separate from immutable artifact receipts.
CREATE TABLE app.run_trace_projections (
  tenant_id uuid NOT NULL,
  run_id uuid NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('execution_stream','native_session')),
  artifact_sha256 text NOT NULL,
  parser_version text NOT NULL,
  reconciliation jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,run_id),
  FOREIGN KEY (tenant_id,run_id) REFERENCES app.runs(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE app.trace_replay_limits (
  tenant_id uuid PRIMARY KEY REFERENCES app.tenants(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0
);
CREATE TABLE app.trace_replay_operations (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  run_id uuid NOT NULL,
  source text NOT NULL CHECK (source IN ('primary','native_session')),
  actor_id text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,request_id),
  FOREIGN KEY (tenant_id,run_id) REFERENCES app.runs(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX trace_replay_run ON app.trace_replay_operations(tenant_id,run_id,created_at DESC);
