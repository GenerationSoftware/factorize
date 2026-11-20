ALTER TABLE app.tenants ADD COLUMN personal_owner_id uuid REFERENCES app.auth_users(id);
CREATE UNIQUE INDEX tenants_personal_owner ON app.tenants(personal_owner_id) WHERE personal_owner_id IS NOT NULL;
WITH owners AS (SELECT DISTINCT ON (tenant_id) tenant_id,user_id FROM app.members WHERE role='owner' ORDER BY tenant_id,created_at,user_id)
UPDATE app.tenants t SET personal_owner_id=o.user_id,name=u.username FROM owners o JOIN app.auth_users u ON u.id=o.user_id WHERE t.id=o.tenant_id;
CREATE FUNCTION app.personal_team_name() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.personal_owner_id IS NOT NULL THEN
    SELECT username INTO NEW.name FROM app.auth_users WHERE id=NEW.personal_owner_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER personal_team_name BEFORE INSERT OR UPDATE ON app.tenants FOR EACH ROW EXECUTE FUNCTION app.personal_team_name();
CREATE FUNCTION app.assign_personal_team() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role='owner' AND NOT EXISTS(SELECT 1 FROM app.tenants WHERE personal_owner_id=NEW.user_id) THEN
    UPDATE app.tenants SET personal_owner_id=NEW.user_id WHERE id=NEW.tenant_id AND personal_owner_id IS NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assign_personal_team AFTER INSERT ON app.members FOR EACH ROW EXECUTE FUNCTION app.assign_personal_team();
CREATE FUNCTION app.rename_personal_team() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE app.tenants SET name=NEW.username,updated_at=now() WHERE personal_owner_id=NEW.id;
  RETURN NEW;
END $$;
CREATE TRIGGER rename_personal_team AFTER UPDATE OF username ON app.auth_users FOR EACH ROW EXECUTE FUNCTION app.rename_personal_team();
INSERT INTO app.schema_migrations(version) VALUES ('0081_personal_team_names') ON CONFLICT DO NOTHING;
