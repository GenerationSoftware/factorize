CREATE TABLE app.auth_totp (
  user_id uuid PRIMARY KEY REFERENCES app.auth_users(id) ON DELETE CASCADE,
  encrypted_secret text NOT NULL,
  last_counter bigint NOT NULL,
  enabled_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.auth_totp_recovery_codes (
  user_id uuid NOT NULL REFERENCES app.auth_totp(user_id) ON DELETE CASCADE,
  digest text NOT NULL,
  PRIMARY KEY(user_id,digest)
);
CREATE TABLE app.auth_totp_enrollments (
  user_id uuid PRIMARY KEY REFERENCES app.auth_users(id) ON DELETE CASCADE,
  browser_digest text NOT NULL,
  session_version integer NOT NULL,
  encrypted_secret text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX auth_totp_enrollments_expiry ON app.auth_totp_enrollments(expires_at);
CREATE TABLE app.auth_totp_challenges (
  digest text PRIMARY KEY,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  session_version integer NOT NULL,
  return_to text NOT NULL,
  expires_at timestamptz NOT NULL,
  FOREIGN KEY(tenant_id,user_id) REFERENCES app.members(tenant_id,user_id) ON DELETE CASCADE
);
CREATE INDEX auth_totp_challenges_expiry ON app.auth_totp_challenges(expires_at);
CREATE TABLE app.auth_totp_limits (
  user_id uuid NOT NULL REFERENCES app.auth_users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('code','settings','challenge')),
  attempts integer NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(user_id,kind)
);
CREATE INDEX auth_totp_limits_expiry ON app.auth_totp_limits(expires_at);
ALTER TABLE app.google_sign_in_attempts ADD COLUMN totp_settings_version integer;
