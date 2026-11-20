-- Legacy links are converted by the following context-preserving migration.
ALTER TABLE app.trigger_skills ADD COLUMN skill_owned boolean NOT NULL DEFAULT false;
ALTER TABLE app.trigger_skills ALTER COLUMN skill_owned SET DEFAULT true;
CREATE UNIQUE INDEX one_owned_trigger_per_skill ON app.trigger_skills(tenant_id,skill_id) WHERE skill_owned;
INSERT INTO app.schema_migrations(version) VALUES ('0083_skill_trigger_ownership') ON CONFLICT DO NOTHING;
