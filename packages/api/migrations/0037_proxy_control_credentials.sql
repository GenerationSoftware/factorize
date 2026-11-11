ALTER TABLE app.credential_proxy_control_credentials
  ADD COLUMN proxy_token_digest bytea UNIQUE;
