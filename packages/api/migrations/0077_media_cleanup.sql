ALTER TABLE app.run_media ADD COLUMN first_linked_at timestamptz;
ALTER TABLE app.run_media ADD COLUMN deleted_at timestamptz;
ALTER TABLE app.run_media ADD COLUMN cleanup_next_at timestamptz;
ALTER TABLE app.run_media ADD COLUMN cleanup_attempt integer NOT NULL DEFAULT 0;
ALTER TABLE app.run_media ADD COLUMN cleanup_error text;
ALTER TABLE app.media_upload_attempts ADD COLUMN cleanup_lease_id uuid;
ALTER TABLE app.media_upload_attempts ADD COLUMN cleanup_lease_expires_at timestamptz;
ALTER TABLE app.media_upload_attempts ADD COLUMN cleanup_next_at timestamptz;
ALTER TABLE app.media_upload_attempts ADD COLUMN cleanup_error text;
ALTER TABLE app.media_upload_attempts ADD COLUMN deleted_at timestamptz;
ALTER TABLE app.run_media_links DROP CONSTRAINT run_media_links_role_check;
ALTER TABLE app.run_media_links ADD CONSTRAINT run_media_links_role_check CHECK(role IN ('input','scratch','result'));
UPDATE app.run_media m SET first_linked_at=(SELECT min(created_at) FROM app.run_media_links l WHERE l.tenant_id=m.tenant_id AND l.media_id=m.id);
CREATE FUNCTION app.mark_media_linked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN UPDATE app.run_media SET first_linked_at=coalesce(first_linked_at,now()) WHERE tenant_id=NEW.tenant_id AND id=NEW.media_id;RETURN NEW;END $$;
CREATE TRIGGER media_linked AFTER INSERT ON app.run_media_links FOR EACH ROW EXECUTE FUNCTION app.mark_media_linked();
INSERT INTO app.schema_migrations(version) VALUES('0077_media_cleanup') ON CONFLICT DO NOTHING;
