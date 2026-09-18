CREATE TABLE IF NOT EXISTS app.run_trace_cursors (
  tenant_id uuid NOT NULL,
  run_id uuid NOT NULL,
  generation text NOT NULL,
  committed_offset bigint NOT NULL DEFAULT 0 CHECK (committed_offset >= 0),
  pending_bytes bytea NOT NULL DEFAULT ''::bytea,
  next_sequence bigint NOT NULL DEFAULT 1 CHECK (next_sequence > 0),
  rolling_hash text NOT NULL DEFAULT repeat('0',64) CHECK (rolling_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,run_id),
  FOREIGN KEY (tenant_id,run_id) REFERENCES app.runs(tenant_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app.run_trace_chunks (
  tenant_id uuid NOT NULL,
  run_id uuid NOT NULL,
  generation text NOT NULL,
  start_offset bigint NOT NULL CHECK (start_offset >= 0),
  end_offset bigint NOT NULL CHECK (end_offset > start_offset),
  chunk_sha256 text NOT NULL CHECK (chunk_sha256 ~ '^[0-9a-f]{64}$'),
  previous_hash text NOT NULL CHECK (previous_hash ~ '^[0-9a-f]{64}$'),
  rolling_hash text NOT NULL CHECK (rolling_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,run_id,generation,start_offset),
  FOREIGN KEY (tenant_id,run_id) REFERENCES app.runs(tenant_id,id) ON DELETE CASCADE
);

INSERT INTO app.schema_migrations(version) VALUES ('0003_incremental_trace_ingestion') ON CONFLICT DO NOTHING;
