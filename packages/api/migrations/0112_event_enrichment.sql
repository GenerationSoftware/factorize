ALTER TABLE app.event_definition_revisions ADD COLUMN enrichment jsonb, ADD COLUMN evaluator_authority jsonb;
ALTER TABLE app.triggers ADD COLUMN input_mapping jsonb;
CREATE TABLE app.event_enrichment_runs (
  tenant_id uuid NOT NULL,
  definition_id uuid NOT NULL,
  trigger_id uuid NOT NULL,
  dedup_digest text NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL CHECK(state IN ('running','matched','excluded','failed')),
  stage text,
  reason text,
  steps jsonb NOT NULL DEFAULT '[]',
  normalized_input jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,trigger_id,dedup_digest),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,definition_id) REFERENCES app.event_definitions(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX event_enrichment_runs_by_event ON app.event_enrichment_runs(tenant_id,definition_id,created_at DESC,id);
