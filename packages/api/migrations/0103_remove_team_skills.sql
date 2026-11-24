-- Disable tenant backfill before removing the team Skills tables.
DROP TRIGGER IF EXISTS enqueue_native_skill_library ON app.tenants;
DROP FUNCTION IF EXISTS app.enqueue_native_skill_library();

UPDATE app.access_tokens
SET scopes = scopes - ARRAY['skills:read', 'skills:write']
WHERE jsonb_typeof(scopes) = 'array' AND scopes ?| ARRAY['skills:read', 'skills:write'];

UPDATE app.agent_identities
SET disabled_scopes = array_remove(array_remove(disabled_scopes, 'skills:read'), 'skills:write'),
    scope_overrides = array_remove(array_remove(scope_overrides, 'skills:read'), 'skills:write')
WHERE disabled_scopes && ARRAY['skills:read', 'skills:write']
   OR scope_overrides && ARRAY['skills:read', 'skills:write'];

UPDATE app.permission_presets
SET scopes = array_remove(array_remove(scopes, 'skills:read'), 'skills:write'),
    revision = revision + 1,
    updated_at = now()
WHERE scopes && ARRAY['skills:read', 'skills:write'];

UPDATE app.vm_permission_grants
SET scopes = array_remove(array_remove(scopes, 'skills:read'), 'skills:write'),
    revision = revision + 1,
    updated_at = now(),
    updated_by = 'system:skills-retirement'
WHERE scopes && ARRAY['skills:read', 'skills:write'];

UPDATE app.oauth_app_connections
SET scopes = array_remove(array_remove(scopes, 'skills:read'), 'skills:write')
WHERE scopes && ARRAY['skills:read', 'skills:write'];

UPDATE app.oidc_requests
SET scopes = array_remove(array_remove(scopes, 'skills:read'), 'skills:write')
WHERE scopes && ARRAY['skills:read', 'skills:write'];

UPDATE app.oidc_tokens
SET scopes = array_remove(array_remove(scopes, 'skills:read'), 'skills:write')
WHERE scopes && ARRAY['skills:read', 'skills:write'];

INSERT INTO app.schema_migrations(version) VALUES ('0103_remove_team_skills') ON CONFLICT DO NOTHING;
