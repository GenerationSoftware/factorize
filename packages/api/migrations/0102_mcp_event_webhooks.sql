CREATE TABLE app.mcp_event_subscriptions (
  tenant_id uuid NOT NULL,
  id text NOT NULL,
  user_id uuid NOT NULL,
  session_version integer NOT NULL,
  grant_id text NOT NULL,
  client_id text NOT NULL,
  definition_id uuid NOT NULL,
  arguments jsonb NOT NULL,
  callback_url text NOT NULL,
  encrypted_secret text NOT NULL,
  secret_fingerprint text NOT NULL,
  verified_at timestamptz NOT NULL,
  previous_encrypted_secret text,
  rotated_at timestamptz,
  generation uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('active','stopped')),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,definition_id) REFERENCES app.event_definitions(tenant_id,id) ON DELETE CASCADE
);

CREATE INDEX mcp_event_subscriptions_active
  ON app.mcp_event_subscriptions(tenant_id,definition_id,expires_at) WHERE status='active';
CREATE INDEX mcp_event_subscriptions_verification
  ON app.mcp_event_subscriptions(tenant_id,user_id,grant_id,callback_url,secret_fingerprint,verified_at DESC);

CREATE TABLE app.mcp_event_deliveries (
  tenant_id uuid NOT NULL,
  subscription_id text NOT NULL,
  occurrence_id uuid NOT NULL,
  generation uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','accepted','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  claim_id uuid,
  http_status integer,
  last_outcome text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id,subscription_id,occurrence_id),
  FOREIGN KEY (tenant_id,subscription_id) REFERENCES app.mcp_event_subscriptions(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,occurrence_id) REFERENCES app.event_occurrences(tenant_id,id) ON DELETE CASCADE
);

CREATE INDEX mcp_event_deliveries_due ON app.mcp_event_deliveries(next_attempt_at,tenant_id,subscription_id,occurrence_id)
  WHERE status IN ('pending','sending');
CREATE INDEX mcp_event_deliveries_occurrence ON app.mcp_event_deliveries(tenant_id,occurrence_id);
CREATE INDEX event_occurrences_recorded ON app.event_occurrences(tenant_id,definition_id,created_at,id);
