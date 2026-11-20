ALTER TABLE app.skills ADD COLUMN run_defaults jsonb;
ALTER TABLE app.skills ADD COLUMN encrypted_prompt text;
ALTER TABLE app.skills ADD COLUMN encrypted_script text;
ALTER TABLE app.skills ADD COLUMN settings_revision integer NOT NULL DEFAULT 1;
UPDATE app.skills s SET run_defaults=COALESCE((SELECT run_defaults-'capacity' FROM app.team_settings WHERE tenant_id=s.tenant_id),'{}'::jsonb);
ALTER TABLE app.skills ALTER COLUMN run_defaults SET NOT NULL;
CREATE FUNCTION app.initialize_skill_defaults() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.run_defaults IS NULL THEN
    SELECT COALESCE(run_defaults-'capacity','{}'::jsonb) INTO NEW.run_defaults FROM app.team_settings WHERE tenant_id=NEW.tenant_id;
    NEW.run_defaults:=COALESCE(NEW.run_defaults,'{}'::jsonb);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER initialize_skill_defaults BEFORE INSERT ON app.skills FOR EACH ROW EXECUTE FUNCTION app.initialize_skill_defaults();
INSERT INTO app.schema_migrations(version) VALUES ('0082_skill_execution_settings') ON CONFLICT DO NOTHING;
