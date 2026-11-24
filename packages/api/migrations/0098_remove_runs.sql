-- Remove credential-disconnect hooks that only revoked credentials in active Runs.
DROP TRIGGER IF EXISTS integration_run_revocation ON app.integration_records;
DROP TRIGGER IF EXISTS github_run_revocation ON app.github_installations;
DROP TRIGGER IF EXISTS connection_run_revocation ON app.connections;
DROP TRIGGER IF EXISTS fly_run_revocation ON app.fly_connections;
DROP TRIGGER IF EXISTS agent_integration_run_revocation ON app.agent_integrations;
DROP FUNCTION IF EXISTS app.revoke_disconnected_integration() CASCADE;
DROP FUNCTION IF EXISTS app.revoke_disconnected_github() CASCADE;
DROP FUNCTION IF EXISTS app.revoke_disconnected_connection() CASCADE;
DROP FUNCTION IF EXISTS app.revoke_disconnected_fly() CASCADE;
DROP FUNCTION IF EXISTS app.revoke_disconnected_agent_integration() CASCADE;
DROP FUNCTION IF EXISTS app.revoke_selected_run_credential(uuid,text,text) CASCADE;

-- Runs, Jobs, Pi sessions, execution history, and their private artifacts are retired.
-- Drop the data with the feature; this deliberately does not retain a historical API.
DROP TABLE IF EXISTS app.runs CASCADE;
DROP TABLE IF EXISTS app.trigger_runs CASCADE;
DROP TABLE IF EXISTS app.invocations CASCADE;
DROP TABLE IF EXISTS app.pi_tool_calls CASCADE;
DROP TABLE IF EXISTS app.pi_session_events CASCADE;
DROP TABLE IF EXISTS app.pi_sessions CASCADE;
DROP TABLE IF EXISTS app.run_workspaces CASCADE;
DROP TABLE IF EXISTS app.run_media_links CASCADE;
DROP TABLE IF EXISTS app.run_media CASCADE;
DROP TABLE IF EXISTS app.media_upload_attempts CASCADE;
DROP TABLE IF EXISTS app.run_telemetry_content CASCADE;
DROP TABLE IF EXISTS app.run_telemetry_spans CASCADE;
DROP TABLE IF EXISTS app.phoenix_run_links CASCADE;
DROP TABLE IF EXISTS app.trace_replay_operations CASCADE;
DROP TABLE IF EXISTS app.trace_replay_limits CASCADE;
DROP TABLE IF EXISTS app.run_retention_cleanup CASCADE;
DROP TABLE IF EXISTS app.run_authorizations CASCADE;
DROP TABLE IF EXISTS app.run_credential_revocations CASCADE;
DROP TABLE IF EXISTS app.vendor_run_identity_bindings CASCADE;
DROP TABLE IF EXISTS app.credential_run_enrollments CASCADE;
DROP TABLE IF EXISTS app.credential_run_grants CASCADE;
DROP TABLE IF EXISTS app.manual_invocation_permissions CASCADE;
DROP TABLE IF EXISTS app.active_claims CASCADE;
DROP TABLE IF EXISTS app.lifecycle_deliveries CASCADE;
DROP TABLE IF EXISTS app.run_credentials CASCADE;
DROP TABLE IF EXISTS app.user_run_defaults CASCADE;
DROP TABLE IF EXISTS app.vm_presets CASCADE;
DROP TABLE IF EXISTS app.vm_image_verifications CASCADE;
DROP TABLE IF EXISTS app.fly_execution_configurations CASCADE;
DROP TABLE IF EXISTS app.execution_targets CASCADE;
DROP TABLE IF EXISTS app.presets CASCADE;
DROP TABLE IF EXISTS app.preset_revisions CASCADE;
DROP TABLE IF EXISTS app.job_edit_deliveries CASCADE;
DROP TABLE IF EXISTS app.trigger_edit_deliveries CASCADE;
DROP TABLE IF EXISTS app.deleted_trigger_provider_cleanup CASCADE;
DROP TABLE IF EXISTS app.trigger_skills CASCADE;
DROP TABLE IF EXISTS app.projects CASCADE;
DROP TRIGGER IF EXISTS initialize_skill_defaults ON app.skills;
DROP FUNCTION IF EXISTS app.initialize_skill_defaults();
ALTER TABLE app.triggers DROP COLUMN IF EXISTS project_id;
ALTER TABLE app.skills DROP COLUMN IF EXISTS run_defaults;
ALTER TABLE app.skills DROP COLUMN IF EXISTS encrypted_prompt;
ALTER TABLE app.skills DROP COLUMN IF EXISTS encrypted_script;
ALTER TABLE app.skills DROP COLUMN IF EXISTS settings_revision;
ALTER TABLE app.skills DROP COLUMN IF EXISTS preset_migration_pending;
ALTER TABLE app.skills DROP COLUMN IF EXISTS encrypted_preset_migration_body;
ALTER TABLE app.skills DROP COLUMN IF EXISTS preset_migration_source_hash;

-- Triggers watch input sources and publish their assigned Event. Execution state
-- is no longer part of a Trigger.
DROP TRIGGER IF EXISTS triggers_seed_event_definition ON app.triggers;
DROP FUNCTION IF EXISTS app.seed_trigger_event_definition();
ALTER TABLE app.triggers DROP CONSTRAINT IF EXISTS triggers_output_definition_revision_fk;
ALTER TABLE app.triggers ADD COLUMN event_definition_id uuid;
UPDATE app.triggers SET event_definition_id=output_definition_id;
ALTER TABLE app.triggers ALTER COLUMN event_definition_id SET NOT NULL;
ALTER TABLE app.triggers ADD CONSTRAINT triggers_event_definition_fk
  FOREIGN KEY (tenant_id,event_definition_id) REFERENCES app.event_definitions(tenant_id,id) ON DELETE RESTRICT;
ALTER TABLE app.triggers DROP COLUMN IF EXISTS output_definition_id;
ALTER TABLE app.triggers DROP COLUMN IF EXISTS output_definition_revision;
ALTER TABLE app.triggers DROP COLUMN IF EXISTS output_payload_mapping;
ALTER TABLE app.triggers DROP COLUMN IF EXISTS run_scopes;
ALTER TABLE app.triggers DROP COLUMN IF EXISTS encrypted_prompt;
ALTER TABLE app.triggers DROP COLUMN IF EXISTS context_version;
ALTER TABLE app.triggers DROP COLUMN IF EXISTS context_review_required;
ALTER TABLE app.triggers DROP COLUMN IF EXISTS encrypted_run_name_template;
ALTER TABLE app.triggers DROP COLUMN IF EXISTS execution_config;
ALTER TABLE app.triggers DROP COLUMN IF EXISTS tags;
ALTER TABLE app.triggers DROP COLUMN IF EXISTS model;
ALTER TABLE app.triggers DROP COLUMN IF EXISTS effort;
ALTER TABLE app.triggers DROP COLUMN IF EXISTS concurrency_limit;
ALTER TABLE app.team_settings DROP COLUMN IF EXISTS run_defaults;
INSERT INTO app.schema_migrations(version) VALUES ('0098_remove_runs') ON CONFLICT DO NOTHING;

-- Remove execution-only storage and controls. The proxy artifact bucket remains
-- for retained external integration requests and responses.
DROP TABLE IF EXISTS app.run_artifacts CASCADE;
DROP TABLE IF EXISTS app.run_activity CASCADE;
DROP TABLE IF EXISTS app.vm_grants CASCADE;
DROP TABLE IF EXISTS app.model_device_authorizations CASCADE;
DROP TABLE IF EXISTS app.model_pricing_overrides CASCADE;
DROP TABLE IF EXISTS app.phoenix_integrations CASCADE;
DROP TABLE IF EXISTS app.phoenix_span_exports CASCADE;
DELETE FROM app.integration_changes WHERE kind='model';
DELETE FROM app.integration_records WHERE kind='model';
DELETE FROM app.agent_integrations WHERE kind='model';
ALTER TABLE app.agent_integrations DROP CONSTRAINT IF EXISTS agent_integrations_kind_check;
ALTER TABLE app.agent_integrations ADD CONSTRAINT agent_integrations_kind_check CHECK (kind IN ('bearer','github','linear','fly','exe','amp','clickup','x'));
DELETE FROM app.agent_identities WHERE kind <> 'oauth';

ALTER TABLE app.integration_records DROP CONSTRAINT IF EXISTS integration_records_kind_check;
ALTER TABLE app.integration_records DROP CONSTRAINT IF EXISTS integration_records_kind_check1;
ALTER TABLE app.integration_records DROP CONSTRAINT IF EXISTS integration_records_origin_check;
ALTER TABLE app.integration_records ADD CONSTRAINT integration_records_kind_check CHECK (kind='bearer');
ALTER TABLE app.integration_records ADD CONSTRAINT integration_records_origin_check CHECK (origin IS NOT NULL);
ALTER TABLE app.integration_changes DROP CONSTRAINT IF EXISTS integration_changes_kind_check;
ALTER TABLE app.integration_changes DROP CONSTRAINT IF EXISTS integration_changes_origin_check;
ALTER TABLE app.integration_changes ADD CONSTRAINT integration_changes_kind_check CHECK (kind='bearer');
ALTER TABLE app.integration_changes ADD CONSTRAINT integration_changes_origin_check CHECK (origin IS NOT NULL);
DROP TABLE IF EXISTS app.job_runs CASCADE;
DROP TABLE IF EXISTS app.jobs CASCADE;
DROP TABLE IF EXISTS app.deleted_job_provider_cleanup CASCADE;
DROP TABLE IF EXISTS app.job_edit_deliveries CASCADE;
DROP TABLE IF EXISTS app.lifecycle_events CASCADE;
DROP TABLE IF EXISTS app.configuration_diagnostics CASCADE;
DROP TABLE IF EXISTS app.run_trace_chunks CASCADE;
DROP TABLE IF EXISTS app.run_trace_cursors CASCADE;
DROP TABLE IF EXISTS app.run_trace_projections CASCADE;
DROP TABLE IF EXISTS app.run_trace_events CASCADE;
DROP TABLE IF EXISTS app.run_trace_archive CASCADE;

-- Existing API tokens keep only scopes supported by the Events/Triggers/Skills
-- API surface. Run-scoped OAuth identities were deleted above.
UPDATE app.access_tokens
SET scopes = COALESCE((SELECT jsonb_agg(value) FROM jsonb_array_elements(scopes) value
  WHERE value #>> '{}' NOT LIKE 'runs:%' AND value #>> '{}' NOT LIKE 'jobs:%'), '[]'::jsonb)
WHERE jsonb_typeof(scopes)='array';

ALTER TABLE app.event_definition_revisions DROP COLUMN IF EXISTS subscription_filters;
ALTER TABLE app.event_definition_revisions DROP COLUMN IF EXISTS publish_policy;
