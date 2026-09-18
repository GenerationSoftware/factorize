-- Terminal execution evidence is independent of artifact and cleanup errors.
ALTER TABLE app.runs ADD COLUMN execution_diagnostics jsonb;
