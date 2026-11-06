-- Lifecycle events are captured at the terminal transition, while the run and
-- trigger configuration are serialized with a tenant-scoped transaction lock.
CREATE TABLE app.lifecycle_events (
  event_id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  trigger_id uuid NOT NULL,
  source_run_id uuid NOT NULL,
  terminal_state text NOT NULL CHECK (terminal_state IN ('succeeded','failed','stopped')),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id,trigger_id,source_run_id,terminal_state),
  FOREIGN KEY (tenant_id,trigger_id) REFERENCES app.triggers(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,source_run_id) REFERENCES app.runs(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX lifecycle_events_pending ON app.lifecycle_events(event_id);

CREATE FUNCTION app.capture_lifecycle_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IN ('succeeded','failed','stopped') AND OLD.state IS DISTINCT FROM NEW.state THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text, 0));
    INSERT INTO app.lifecycle_events(tenant_id,trigger_id,source_run_id,terminal_state)
      SELECT NEW.tenant_id,t.id,NEW.id,NEW.state
      FROM app.triggers t
      JOIN app.jobs j ON j.tenant_id=t.tenant_id AND j.id=t.job_id
      WHERE t.tenant_id=NEW.tenant_id AND t.kind='jobLifecycle'
        AND t.enabled AND t.removed_at IS NULL AND j.enabled
        AND COALESCE(t.config->'sourceJobIds',jsonb_build_array(t.config->>'sourceJobId')) ? NEW.job_id::text
        AND COALESCE(t.config->'states',t.config->'terminalStates','["succeeded","failed","stopped"]'::jsonb) ? NEW.state
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER app_capture_lifecycle_transition
  AFTER UPDATE OF state ON app.runs
  FOR EACH ROW EXECUTE FUNCTION app.capture_lifecycle_transition();

-- Preserve only work the old scheduler had already committed an invocation
-- for but had not yet acknowledged. Current terminal state alone is not proof
-- that an old subscription was waiting for a delivery.
INSERT INTO app.lifecycle_events(tenant_id,trigger_id,source_run_id,terminal_state)
SELECT t.tenant_id,t.id,r.id,r.state
FROM app.triggers t
JOIN app.jobs j ON j.tenant_id=t.tenant_id AND j.id=t.job_id
JOIN app.runs r ON r.tenant_id=t.tenant_id
  AND COALESCE(t.config->'sourceJobIds',jsonb_build_array(t.config->>'sourceJobId')) ? r.job_id::text
JOIN app.invocations i ON i.tenant_id=t.tenant_id AND i.job_id=t.job_id AND i.trigger_id=t.id
  AND i.claim_key='lifecycle:'||t.id::text||':'||r.id::text||':'||r.state
WHERE t.kind='jobLifecycle' AND t.enabled AND t.removed_at IS NULL AND j.enabled
  AND r.state IN ('succeeded','failed','stopped')
  AND COALESCE(t.config->'states',t.config->'terminalStates','["succeeded","failed","stopped"]'::jsonb) ? r.state
  AND NOT EXISTS (SELECT 1 FROM app.lifecycle_deliveries d WHERE d.tenant_id=t.tenant_id AND d.trigger_id=t.id AND d.source_run_id=r.id AND d.terminal_state=r.state)
ON CONFLICT DO NOTHING;
