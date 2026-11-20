-- Shared team namespace. Artifact pointers and historical run snapshots keep
-- their original identifiers and object keys.
CREATE TABLE app.resource_names (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  name text NOT NULL CHECK(name <> 'manual'),
  kind text NOT NULL CHECK(kind IN ('skill','trigger')),
  resource_id uuid NOT NULL,
  PRIMARY KEY(tenant_id,name), UNIQUE(tenant_id,kind,resource_id)
);
CREATE TABLE app.configuration_diagnostics (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  resource_kind text NOT NULL, resource_id uuid NOT NULL, code text NOT NULL,
  details jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,resource_kind,resource_id,code)
);
CREATE TEMP TABLE migrating_resource_names ON COMMIT DROP AS
SELECT tenant_id,id,'skill'::text kind,key original_name,key candidate FROM app.skills
UNION ALL SELECT tenant_id,id,'trigger',name,CASE WHEN name ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(name)<=64 THEN name ELSE slug END FROM app.triggers;
UPDATE app.skills SET key='$migrate$'||id;
UPDATE app.triggers SET slug='$migrate$'||id;
DO $$
DECLARE item record; chosen text; suffix text; attempt integer;
BEGIN
  FOR item IN SELECT * FROM migrating_resource_names ORDER BY tenant_id,kind,id LOOP
    chosen := trim(both '-' FROM left(regexp_replace(lower(item.candidate),'[^a-z0-9]+','-','g'),64));
    IF chosen='' THEN chosen:=item.kind; END IF;
    IF chosen='manual' OR EXISTS(SELECT 1 FROM app.resource_names WHERE tenant_id=item.tenant_id AND name=chosen) THEN
      suffix:=replace(item.id::text,'-',''); attempt:=0;
      LOOP
        chosen:=trim(trailing '-' FROM left(chosen,22))||'-'||suffix||CASE WHEN attempt=0 THEN '' ELSE '-'||attempt::text END;
        EXIT WHEN NOT EXISTS(SELECT 1 FROM app.resource_names WHERE tenant_id=item.tenant_id AND name=chosen);
        attempt:=attempt+1;
      END LOOP;
    END IF;
    INSERT INTO app.resource_names VALUES(item.tenant_id,chosen,item.kind,item.id);
    IF item.kind='skill' THEN UPDATE app.skills SET key=chosen WHERE tenant_id=item.tenant_id AND id=item.id;
    ELSE UPDATE app.triggers SET name=chosen,slug=chosen WHERE tenant_id=item.tenant_id AND id=item.id; END IF;
    IF chosen<>item.original_name THEN
      INSERT INTO app.configuration_diagnostics(tenant_id,resource_kind,resource_id,code,details)
      VALUES(item.tenant_id,item.kind,item.id,'name_migrated',jsonb_build_object('previousName',item.original_name,'name',chosen));
    END IF;
  END LOOP;
END $$;
CREATE FUNCTION app.sync_resource_name() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resource_kind text; selected_name text;
BEGIN
  resource_kind:=CASE TG_TABLE_NAME WHEN 'skills' THEN 'skill' ELSE 'trigger' END;
  IF TG_OP='DELETE' THEN
    DELETE FROM app.resource_names WHERE tenant_id=OLD.tenant_id AND kind=resource_kind AND resource_id=OLD.id;
    RETURN OLD;
  END IF;
  selected_name:=to_jsonb(NEW)->>CASE TG_TABLE_NAME WHEN 'skills' THEN 'key' ELSE 'name' END;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text,1));
  IF TG_OP='UPDATE' THEN
    IF selected_name=(to_jsonb(OLD)->>CASE TG_TABLE_NAME WHEN 'skills' THEN 'key' ELSE 'name' END) THEN RETURN NEW; END IF;
    DELETE FROM app.resource_names WHERE tenant_id=OLD.tenant_id AND kind=resource_kind AND resource_id=OLD.id;
  END IF;
  IF EXISTS(SELECT 1 FROM app.resource_names WHERE tenant_id=NEW.tenant_id AND name=selected_name AND kind=resource_kind AND resource_id=NEW.id) THEN RETURN NEW; END IF;
  INSERT INTO app.resource_names VALUES(NEW.tenant_id,selected_name,resource_kind,NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER skills_name BEFORE INSERT OR UPDATE OF key ON app.skills FOR EACH ROW EXECUTE FUNCTION app.sync_resource_name();
CREATE TRIGGER triggers_name BEFORE INSERT OR UPDATE OF name ON app.triggers FOR EACH ROW EXECUTE FUNCTION app.sync_resource_name();
CREATE TRIGGER skills_name_deleted AFTER DELETE ON app.skills FOR EACH ROW EXECUTE FUNCTION app.sync_resource_name();
CREATE TRIGGER triggers_name_deleted AFTER DELETE ON app.triggers FOR EACH ROW EXECUTE FUNCTION app.sync_resource_name();
INSERT INTO app.schema_migrations(version) VALUES('0070_resource_names') ON CONFLICT DO NOTHING;
