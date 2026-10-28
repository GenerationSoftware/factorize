ALTER TABLE app.triggers DROP CONSTRAINT triggers_kind_check;
ALTER TABLE app.triggers ADD CONSTRAINT triggers_kind_check CHECK (kind IN ('manual','schedule','webhook','jobLifecycle','jobIdle'));
ALTER TABLE app.invocations DROP CONSTRAINT invocations_source_check;
ALTER TABLE app.invocations ADD CONSTRAINT invocations_source_check CHECK (source IN ('manual','schedule','webhook','jobLifecycle','jobIdle'));
