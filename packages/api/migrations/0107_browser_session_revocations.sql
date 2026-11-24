-- A browser sign-out revokes only that cookie, without changing the
-- membership version used to invalidate credentials after security events.
CREATE TABLE app.revoked_browser_sessions (
  digest text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
CREATE INDEX revoked_browser_sessions_expiry_idx ON app.revoked_browser_sessions (expires_at);
