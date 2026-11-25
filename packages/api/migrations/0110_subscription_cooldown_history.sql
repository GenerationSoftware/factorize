ALTER TABLE app.mcp_event_subscriptions
  ADD COLUMN last_cooldown_started_at timestamptz,
  ADD COLUMN last_cooldown_ends_at timestamptz;

-- The operational end can be known for existing cooldowns, but the start
-- cannot be reconstructed: duration is per acknowledgment and not retained.
UPDATE app.mcp_event_subscriptions
SET last_cooldown_ends_at=cooldown_until
WHERE cooldown_until IS NOT NULL;
