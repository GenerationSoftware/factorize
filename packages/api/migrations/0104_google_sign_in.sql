CREATE TABLE app.google_sign_in_attempts (
  id uuid PRIMARY KEY,
  browser_digest text NOT NULL UNIQUE,
  verifier text,
  nonce text NOT NULL,
  return_to text NOT NULL,
  connection_id uuid REFERENCES app.oauth_connections(id) ON DELETE CASCADE,
  google_subject text,
  email text,
  existing_user_id uuid REFERENCES app.auth_users(id) ON DELETE CASCADE,
  email_confirmed boolean NOT NULL DEFAULT false,
  email_token_digest text,
  email_sent_at timestamptz,
  password_attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL
);
CREATE INDEX google_sign_in_attempts_expiry ON app.google_sign_in_attempts(expires_at);
CREATE UNIQUE INDEX auth_accounts_google_user_unique ON app.auth_accounts(user_id) WHERE provider='google';
