-- Event deletion removes its dependent Triggers. Trigger-owned source rows,
-- schedule state, and match records already cascade from the Trigger; Event
-- schema revisions cascade to their durable occurrences.
ALTER TABLE app.triggers DROP CONSTRAINT IF EXISTS triggers_event_definition_fk;
ALTER TABLE app.triggers ADD CONSTRAINT triggers_event_definition_fk
  FOREIGN KEY (tenant_id,event_definition_id)
  REFERENCES app.event_definitions(tenant_id,id) ON DELETE CASCADE;

-- Owner-managed scope overrides can expand or restrict a connected OAuth
-- client's effective scopes independently of the original OAuth grant.
ALTER TABLE app.agent_identities ADD COLUMN scope_overrides text[];

-- A team may define named scope sets and select one default for new OAuth
-- authorizations. Scope names are validated against active platform scopes
-- and integrations by the API before writes.
CREATE TABLE app.permission_presets (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  name text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  is_default boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id)
);
CREATE UNIQUE INDEX permission_presets_name ON app.permission_presets(tenant_id,lower(name));
CREATE UNIQUE INDEX permission_presets_default ON app.permission_presets(tenant_id) WHERE is_default;

INSERT INTO app.schema_migrations(version) VALUES ('0100_event_cascade_and_permission_presets') ON CONFLICT DO NOTHING;
