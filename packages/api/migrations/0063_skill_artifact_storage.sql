-- Legacy ciphertext remains readable until the tenant's Artifacts content has been verified.
ALTER TABLE app.skills ALTER COLUMN encrypted_body DROP NOT NULL;
ALTER TABLE app.skills ADD COLUMN artifact_version jsonb;
ALTER TABLE app.skill_libraries ADD COLUMN github_tree text;
CREATE TABLE app.skill_library_backfill (
  tenant_id uuid PRIMARY KEY REFERENCES app.tenants(id) ON DELETE CASCADE,
  attempted_at timestamptz,
  error text
);
INSERT INTO app.skill_library_backfill(tenant_id) SELECT id FROM app.tenants;
CREATE FUNCTION app.enqueue_native_skill_library() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO app.skill_library_backfill(tenant_id) VALUES(NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER enqueue_native_skill_library AFTER INSERT ON app.tenants
FOR EACH ROW EXECUTE FUNCTION app.enqueue_native_skill_library();
