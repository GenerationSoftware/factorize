-- Historical receipts remain readable with an unknown generation.
ALTER TABLE app.run_artifacts ADD COLUMN source_generation text;
INSERT INTO app.schema_migrations(version) VALUES ('0012_canonical_trace_receipts') ON CONFLICT DO NOTHING;
