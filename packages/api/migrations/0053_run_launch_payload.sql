-- Exact scheduler launch snapshots; plaintext prompts and scripts remain encrypted.
ALTER TABLE app.runs ADD COLUMN encrypted_launch_payload text;
INSERT INTO app.schema_migrations(version) VALUES ('0053_run_launch_payload') ON CONFLICT DO NOTHING;
