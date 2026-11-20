-- Session bytes are encrypted at the application boundary; infrastructure credentials
-- remain in integrations and are resolved for each provider request.
CREATE TABLE app.pi_sessions (
  tenant_id uuid NOT NULL,
  run_id uuid NOT NULL,
  framework_version text NOT NULL DEFAULT '1.5.2',
  encrypted_messages text NOT NULL,
  status text NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','running','complete','failed','stopped','uncertain')),
  epoch bigint NOT NULL DEFAULT 0,
  lease_id uuid,
  lease_expires_at timestamptz,
  sequence bigint NOT NULL DEFAULT 0,
  turn_count integer NOT NULL DEFAULT 0,
  compaction_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,run_id),
  FOREIGN KEY(tenant_id,run_id) REFERENCES app.runs(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE app.pi_session_events (
  tenant_id uuid NOT NULL,
  run_id uuid NOT NULL,
  sequence bigint NOT NULL,
  event_type text NOT NULL,
  encrypted_event text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,run_id,sequence),
  FOREIGN KEY(tenant_id,run_id) REFERENCES app.pi_sessions(tenant_id,run_id) ON DELETE CASCADE
);
CREATE TABLE app.pi_tool_calls (
  tenant_id uuid NOT NULL,
  run_id uuid NOT NULL,
  call_id text NOT NULL,
  tool_name text NOT NULL,
  encrypted_arguments text NOT NULL,
  state text NOT NULL CHECK(state IN ('started','complete','uncertain')),
  encrypted_result text,
  epoch bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,run_id,call_id),
  FOREIGN KEY(tenant_id,run_id) REFERENCES app.pi_sessions(tenant_id,run_id) ON DELETE CASCADE
);
CREATE INDEX pi_sessions_expired_lease ON app.pi_sessions(lease_expires_at) WHERE status='running';
-- Preserve retired harness choices as diagnostics rather than interpreting them
-- as live provider selection. Terminal run configurations and trace bytes stay intact.
INSERT INTO app.configuration_diagnostics(tenant_id,resource_kind,resource_id,code,details)
SELECT tenant_id,'team',tenant_id,'managed_agent_cutover',jsonb_build_object('previousModelProvider',run_defaults->'modelProvider','message','Configure an OpenAI-compatible model integration and model for hosted Pi.')
FROM app.team_settings WHERE run_defaults ? 'modelProvider';
UPDATE app.team_settings SET run_defaults=run_defaults-'modelProvider';
INSERT INTO app.configuration_diagnostics(tenant_id,resource_kind,resource_id,code,details)
SELECT tenant_id,'trigger',id,'managed_agent_cutover',jsonb_build_object('previousAgentKind',execution_config->'agentKind','message','Managed agents now use hosted Pi. Configure a model integration and model before the next run.')
FROM app.triggers WHERE coalesce(execution_config->>'executionType','agent')<>'code';
UPDATE app.triggers SET execution_config=(execution_config-'modelProvider')||'{"agentKind":"pi"}'::jsonb WHERE coalesce(execution_config->>'executionType','agent')<>'code';
INSERT INTO app.schema_migrations(version) VALUES('0073_hosted_pi_sessions') ON CONFLICT DO NOTHING;
