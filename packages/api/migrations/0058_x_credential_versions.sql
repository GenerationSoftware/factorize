ALTER TABLE app.x_connections
  ADD COLUMN credential_version integer NOT NULL DEFAULT 1;

ALTER TABLE app.x_oauth_attempts
  ADD COLUMN credential_version integer NOT NULL DEFAULT 1;
