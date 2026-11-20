CREATE TABLE app.skill_content_cache (
 tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
 repository text NOT NULL,
 commit_sha text NOT NULL,
 encrypted_content text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,repository,commit_sha)
);
INSERT INTO app.schema_migrations(version) VALUES ('0085_skill_content_cache') ON CONFLICT DO NOTHING;
