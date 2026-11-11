-- Historical terminal cleanup is independent from the ordinary run poller.
ALTER TABLE app.runs
  ADD COLUMN provider_cleanup_attempt integer NOT NULL DEFAULT 0,
  ADD COLUMN provider_cleanup_next_at timestamptz,
  ADD COLUMN provider_cleanup_error text;

CREATE INDEX runs_provider_cleanup_due
  ON app.runs(provider_cleanup_next_at, created_at, tenant_id, id)
  WHERE NOT vm_cleanup_complete AND state IN ('succeeded','failed','stopped');

INSERT INTO app.schema_migrations(version) VALUES ('0038_provider_cleanup_reconciliation') ON CONFLICT DO NOTHING;
