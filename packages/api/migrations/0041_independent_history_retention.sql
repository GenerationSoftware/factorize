-- Bounded 14-day cleanup scans for histories and temporary authentication records.
CREATE INDEX job_events_retention ON app.job_events(received_at,tenant_id,id);
CREATE INDEX webhook_deliveries_retention ON app.webhook_deliveries(received_at,tenant_id,id) WHERE outcome <> 'received';
CREATE INDEX pending_verifications_by_delivery ON app.pending_verifications(tenant_id,delivery_id);
CREATE INDEX vm_image_verifications_retention ON app.vm_image_verifications(created_at,tenant_id,id) WHERE status IN ('succeeded','failed');
CREATE INDEX github_setup_states_expiration ON app.github_setup_states(expires_at,tenant_id,nonce);
CREATE INDEX auth_reset_tokens_expiration ON app.auth_reset_tokens(expires_at,digest);
CREATE INDEX auth_sessions_expiration ON app.auth_sessions(expires_at,id);
CREATE INDEX access_tokens_expiration ON app.access_tokens(expires_at,tenant_id,id);

INSERT INTO app.schema_migrations(version) VALUES ('0041_independent_history_retention') ON CONFLICT DO NOTHING;
