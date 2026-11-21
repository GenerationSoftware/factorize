-- Existing exe.dev grants keep their original identity and expiration.
ALTER TABLE app.vm_grants ADD COLUMN app text;
ALTER TABLE app.vm_grants ADD CONSTRAINT vm_grant_app CHECK (app IS NULL OR app ~ '^[a-z0-9][a-z0-9-]{0,62}$');
INSERT INTO app.schema_migrations(version) VALUES ('0093_fly_vm_grants');
