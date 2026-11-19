ALTER TABLE app.agent_identities
  ADD COLUMN display_name text,
  ADD COLUMN disabled_scopes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN integration_overrides jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN permissions_revision integer NOT NULL DEFAULT 0;
