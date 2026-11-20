-- New teams have concrete capacity and least-privilege application defaults.
-- Provider-specific settings still require an explicit selection.
ALTER TABLE app.team_settings ALTER COLUMN run_defaults SET DEFAULT
'{"capacity":4,"concurrencyLimit":1,"runScopes":["team:read","triggers:read","runs:read","integrations:read","skills:read","runs:invoke"],"portableIntegrationIds":[],"githubInstallationIds":[],"linearConnectionId":null,"xConnectionIds":[],"allowedTriggerIds":[]}'::jsonb;
UPDATE app.team_settings SET run_defaults=
'{"capacity":4,"concurrencyLimit":1,"runScopes":["team:read","triggers:read","runs:read","integrations:read","skills:read","runs:invoke"],"portableIntegrationIds":[],"githubInstallationIds":[],"linearConnectionId":null,"xConnectionIds":[],"allowedTriggerIds":[]}'::jsonb || run_defaults;
INSERT INTO app.schema_migrations(version) VALUES('0071_team_permission_defaults') ON CONFLICT DO NOTHING;
