ALTER TABLE app.integration_collections
  ADD COLUMN changes_pruned_through bigint NOT NULL DEFAULT 0 CHECK (changes_pruned_through >= 0);

CREATE INDEX integration_changes_retention
  ON app.integration_changes(created_at,tenant_id,revision);
