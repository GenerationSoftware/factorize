ALTER TABLE app.mcp_event_subscriptions
  ADD COLUMN ack_epoch uuid,
  ADD COLUMN ack_timeout_seconds integer NOT NULL DEFAULT 300 CHECK (ack_timeout_seconds BETWEEN 30 AND 86400),
  ADD COLUMN cooldown_until timestamptz;

ALTER TABLE app.mcp_event_deliveries
  ADD COLUMN ack_epoch uuid,
  ADD COLUMN ack_state text CHECK (ack_state IN ('pending','awaiting_ack','processed','waived','exhausted','cancelled')),
  ADD COLUMN ack_due_at timestamptz,
  ADD COLUMN ack_updated_at timestamptz,
  ADD COLUMN recovery_event_id uuid,
  ADD COLUMN recovery_attempts integer NOT NULL DEFAULT 0 CHECK (recovery_attempts >= 0);

CREATE INDEX mcp_event_deliveries_ack_due ON app.mcp_event_deliveries(ack_due_at,tenant_id,subscription_id,occurrence_id)
  WHERE ack_state='awaiting_ack';
