ALTER TABLE app.event_definition_revisions
  ADD COLUMN enrichment_pause_reason text CHECK (enrichment_pause_reason = 'integration_removed');
