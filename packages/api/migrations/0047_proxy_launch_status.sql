ALTER TABLE app.credential_proxy_states
  ADD COLUMN unlocked boolean NOT NULL DEFAULT false;
