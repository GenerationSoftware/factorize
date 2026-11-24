-- A provider delivery may match sibling Triggers for the same Event, but must
-- create only one occurrence for that Event. The same delivery may publish a
-- different Event independently.
ALTER TABLE app.event_occurrences
  DROP CONSTRAINT IF EXISTS event_occurrences_tenant_id_source_identity_idempotency_key_key;
ALTER TABLE app.event_occurrences
  ADD CONSTRAINT event_occurrences_event_source_delivery_key
  UNIQUE (tenant_id,definition_id,source_identity,idempotency_key);

INSERT INTO app.schema_migrations(version) VALUES ('0099_event_delivery_uniqueness') ON CONFLICT DO NOTHING;
