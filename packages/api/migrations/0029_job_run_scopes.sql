-- Preserve existing job and in-flight credential authority on rollout.
ALTER TABLE app.jobs ADD COLUMN run_scopes jsonb NOT NULL
  DEFAULT '["projects:read","jobs:read","runs:read","integrations:read","skills:read","runs:invoke"]'::jsonb;
ALTER TABLE app.jobs ADD CONSTRAINT jobs_run_scopes_array CHECK (jsonb_typeof(run_scopes) = 'array');
ALTER TABLE app.run_credentials ADD COLUMN scopes jsonb NOT NULL
  DEFAULT '["projects:read","jobs:read","runs:read","integrations:read","skills:read","runs:invoke"]'::jsonb;
ALTER TABLE app.run_credentials ADD CONSTRAINT run_credentials_scopes_array CHECK (jsonb_typeof(scopes) = 'array');
