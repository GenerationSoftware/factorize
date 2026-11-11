CREATE TABLE app.integration_generation_journal (
  tenant_id uuid NOT NULL REFERENCES app.integration_collections(tenant_id) ON DELETE CASCADE,
  generation_id uuid NOT NULL,
  expected_revision bigint NOT NULL CHECK (expected_revision >= 0),
  content_hash text NOT NULL CHECK (length(content_hash) = 64),
  state text NOT NULL CHECK (state IN ('staged','committed','rolled_back','expired')),
  committed_revision bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  PRIMARY KEY (tenant_id,generation_id),
  CHECK ((state = 'committed' AND committed_revision IS NOT NULL AND committed_at IS NOT NULL)
    OR state <> 'committed')
);
CREATE INDEX integration_generation_cleanup ON app.integration_generation_journal(created_at,tenant_id)
  WHERE state IN ('staged','committed','rolled_back','expired');

-- These tables contain metadata and user ciphertext only. The archive tables
-- retain one prior generation so a just-committed rotation can be rolled back.
CREATE TABLE app.integration_generation_records (
  tenant_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('bearer','model')),
  name text NOT NULL,
  origin text,
  description text,
  revision bigint NOT NULL CHECK (revision > 0),
  encrypted_payload text,
  deleted_at timestamptz,
  PRIMARY KEY (tenant_id,generation_id,id),
  FOREIGN KEY (tenant_id,generation_id) REFERENCES app.integration_generation_journal(tenant_id,generation_id) ON DELETE CASCADE,
  CHECK ((kind = 'bearer' AND origin IS NOT NULL) OR (kind = 'model' AND origin IS NULL)),
  CHECK ((deleted_at IS NULL AND encrypted_payload IS NOT NULL) OR (deleted_at IS NOT NULL AND encrypted_payload IS NULL))
);
CREATE TABLE app.integration_generation_changes (
  tenant_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('upsert','delete')),
  record_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('bearer','model')),
  name text NOT NULL,
  origin text,
  description text,
  encrypted_payload text,
  PRIMARY KEY (tenant_id,generation_id,revision),
  UNIQUE (tenant_id,generation_id,idempotency_key),
  FOREIGN KEY (tenant_id,generation_id) REFERENCES app.integration_generation_journal(tenant_id,generation_id) ON DELETE CASCADE,
  CHECK ((kind = 'bearer' AND origin IS NOT NULL) OR (kind = 'model' AND origin IS NULL)),
  CHECK ((operation = 'upsert' AND encrypted_payload IS NOT NULL) OR (operation = 'delete' AND encrypted_payload IS NULL))
);
CREATE TABLE app.integration_generation_previous_records (LIKE app.integration_records INCLUDING DEFAULTS);
ALTER TABLE app.integration_generation_previous_records ADD COLUMN generation_id uuid NOT NULL;
ALTER TABLE app.integration_generation_previous_records ADD PRIMARY KEY (tenant_id,generation_id,id);
ALTER TABLE app.integration_generation_previous_records ADD FOREIGN KEY (tenant_id) REFERENCES app.integration_collections(tenant_id) ON DELETE CASCADE;
ALTER TABLE app.integration_generation_previous_records ADD FOREIGN KEY (tenant_id,generation_id) REFERENCES app.integration_generation_journal(tenant_id,generation_id) ON DELETE CASCADE;
CREATE TABLE app.integration_generation_previous_changes (LIKE app.integration_changes INCLUDING DEFAULTS);
ALTER TABLE app.integration_generation_previous_changes ADD COLUMN generation_id uuid NOT NULL;
ALTER TABLE app.integration_generation_previous_changes ADD PRIMARY KEY (tenant_id,generation_id,revision);
ALTER TABLE app.integration_generation_previous_changes ADD FOREIGN KEY (tenant_id) REFERENCES app.integration_collections(tenant_id) ON DELETE CASCADE;
ALTER TABLE app.integration_generation_previous_changes ADD FOREIGN KEY (tenant_id,generation_id) REFERENCES app.integration_generation_journal(tenant_id,generation_id) ON DELETE CASCADE;
