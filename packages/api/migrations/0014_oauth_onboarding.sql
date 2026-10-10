-- Individual browser-bound requests survive email delivery without sharing a return cookie.
CREATE TABLE app.oauth_connections (
  id uuid PRIMARY KEY,
  browser_digest text NOT NULL,
  destination text NOT NULL,
  device_user_code text,
  client_name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('callback','device')),
  expires_at timestamptz NOT NULL,
  user_id uuid REFERENCES app.auth_users(id) ON DELETE CASCADE,
  ready_version integer,
  ready boolean NOT NULL DEFAULT false,
  used_at timestamptz
);
ALTER TABLE app.auth_reset_tokens ADD COLUMN connection_id uuid REFERENCES app.oauth_connections(id) ON DELETE SET NULL;
CREATE TABLE app.oauth_consent_previews (
  id uuid PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE INDEX oauth_connections_expires ON app.oauth_connections(expires_at);
CREATE INDEX oauth_consent_previews_expires ON app.oauth_consent_previews(expires_at);
