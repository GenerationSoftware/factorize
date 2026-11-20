ALTER TABLE app.auth_users ADD COLUMN username text;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM app.auth_users WHERE length(split_part(lower(email),'@',1)) NOT BETWEEN 3 AND 39 OR split_part(lower(email),'@',1) !~ '^[a-z0-9]+(-[a-z0-9]+)*$') THEN
    RAISE EXCEPTION 'Username migration: an email prefix is not a valid username; choose a valid username before migrating';
  END IF;
  IF EXISTS (SELECT 1 FROM app.auth_users GROUP BY split_part(lower(email),'@',1) HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Username migration: duplicate email prefixes; choose distinct usernames before migrating';
  END IF;
END $$;
UPDATE app.auth_users SET username=split_part(lower(email),'@',1);
ALTER TABLE app.auth_users ALTER COLUMN username SET NOT NULL;
-- Internal identity provisioning still needs an identity before public signup.
ALTER TABLE app.auth_users ALTER COLUMN username SET DEFAULT ('user-' || replace(gen_random_uuid()::text,'-',''));
ALTER TABLE app.auth_users ADD CONSTRAINT auth_users_username_format CHECK(length(username) BETWEEN 3 AND 39 AND username ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE app.auth_users ADD CONSTRAINT auth_users_username_unique UNIQUE(username);
INSERT INTO app.schema_migrations(version) VALUES ('0080_usernames') ON CONFLICT DO NOTHING;
