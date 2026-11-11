CREATE TABLE app.integration_collections (
  tenant_id uuid PRIMARY KEY REFERENCES app.tenants(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.integration_records (
  tenant_id uuid NOT NULL REFERENCES app.integration_collections(tenant_id) ON DELETE CASCADE,
  id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('bearer','model')),
  name text NOT NULL,
  origin text,
  description text,
  revision bigint NOT NULL CHECK (revision > 0),
  encrypted_payload text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  CHECK ((kind = 'bearer' AND origin IS NOT NULL) OR (kind = 'model' AND origin IS NULL)),
  CHECK ((deleted_at IS NULL AND encrypted_payload IS NOT NULL) OR (deleted_at IS NOT NULL AND encrypted_payload IS NULL))
);
CREATE UNIQUE INDEX integration_records_active_name ON app.integration_records(tenant_id,kind,lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX integration_records_collection_order ON app.integration_records(tenant_id,revision,id);

CREATE TABLE app.integration_changes (
  tenant_id uuid NOT NULL REFERENCES app.integration_collections(tenant_id) ON DELETE CASCADE,
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
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,revision),
  UNIQUE (tenant_id,idempotency_key),
  CHECK ((kind = 'bearer' AND origin IS NOT NULL) OR (kind = 'model' AND origin IS NULL)),
  CHECK ((operation = 'upsert' AND encrypted_payload IS NOT NULL) OR (operation = 'delete' AND encrypted_payload IS NULL))
);
CREATE INDEX integration_changes_page ON app.integration_changes(tenant_id,revision);
