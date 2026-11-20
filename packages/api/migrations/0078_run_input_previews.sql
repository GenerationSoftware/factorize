ALTER TABLE app.runs ADD COLUMN encrypted_prompt_preview text;
ALTER TABLE app.runs ADD COLUMN encrypted_context_prompt text;
-- Existing source names were captured on insert. Fill only missing snapshots;
-- keep retained names for deleted resources and all original prompt/trace data.
UPDATE app.runs r SET source_trigger_name=j.name FROM app.triggers j
 WHERE r.tenant_id=j.tenant_id AND r.trigger_id=j.id AND r.source_trigger_name IS NULL;
INSERT INTO app.schema_migrations(version) VALUES('0078_run_input_previews') ON CONFLICT DO NOTHING;
