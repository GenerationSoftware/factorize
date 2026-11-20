CREATE TABLE app.presets (
 tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
 id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('vm','permission','model')),
 slug text NOT NULL CHECK(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 name text NOT NULL,
 revision integer NOT NULL DEFAULT 1,
 settings jsonb NOT NULL,
 is_default boolean NOT NULL DEFAULT false,
 deleted boolean NOT NULL DEFAULT false,
 PRIMARY KEY(tenant_id,id),
 UNIQUE(tenant_id,kind,slug),
 CHECK(NOT (deleted AND is_default))
);
CREATE UNIQUE INDEX presets_default ON app.presets(tenant_id,kind) WHERE is_default;
CREATE TABLE app.preset_revisions (
 tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
 preset_id uuid NOT NULL,
 revision integer NOT NULL,
 kind text NOT NULL,
 slug text NOT NULL,
 name text NOT NULL,
 settings jsonb NOT NULL,
 PRIMARY KEY(tenant_id,preset_id,revision)
);
CREATE FUNCTION app.record_preset_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.revision<>OLD.revision THEN
  INSERT INTO app.preset_revisions VALUES(NEW.tenant_id,NEW.id,NEW.revision,NEW.kind,NEW.slug,NEW.name,NEW.settings);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER preset_revision AFTER INSERT OR UPDATE ON app.presets FOR EACH ROW EXECUTE FUNCTION app.record_preset_revision();
ALTER TABLE app.skills ADD COLUMN definition jsonb;
ALTER TABLE app.skills ADD COLUMN preset_migration_pending boolean NOT NULL DEFAULT false;
ALTER TABLE app.skills ADD COLUMN encrypted_preset_migration_body text;
ALTER TABLE app.skills ADD COLUMN preset_migration_source_hash text;
UPDATE app.skills SET preset_migration_pending=true;
INSERT INTO app.schema_migrations(version) VALUES('0092_presets');
DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT conname FROM pg_constraint WHERE conrelid='app.triggers'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%concurrency_limit%' LOOP
  EXECUTE format('ALTER TABLE app.triggers DROP CONSTRAINT %I',item.conname);
 END LOOP;
END $$;
ALTER TABLE app.triggers ADD CONSTRAINT triggers_concurrency_nonnegative CHECK(concurrency_limit>=0);
CREATE INDEX skills_key_trigram ON app.skills USING gin(key gin_trgm_ops);
