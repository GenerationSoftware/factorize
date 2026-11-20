ALTER TABLE app.pi_sessions ADD COLUMN telemetry_sequence bigint NOT NULL DEFAULT 0;
INSERT INTO app.schema_migrations(version) VALUES ('0091_telemetry_journal_recovery') ON CONFLICT DO NOTHING;
