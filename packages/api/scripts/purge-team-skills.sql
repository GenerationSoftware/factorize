-- Run after the release that retires team Skills writes and drops tenant backfill.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('factorize:migrations'));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.schema_migrations WHERE version = '0103_remove_team_skills') THEN
    RAISE EXCEPTION 'Apply migration 0103_remove_team_skills before purging team Skills';
  END IF;
END $$;

DROP TABLE IF EXISTS app.skill_git_tokens;
DROP TABLE IF EXISTS app.skill_git_namespaces;
DROP TABLE IF EXISTS app.skill_content_cache;
DROP TABLE IF EXISTS app.skill_library_backfill;
DROP TABLE IF EXISTS app.skill_libraries;
DROP TABLE IF EXISTS app.legacy_trigger_skill_links;
DROP TABLE IF EXISTS app.skills;

-- Free retired Skill names while preserving the Trigger namespace.
DELETE FROM app.resource_names WHERE kind = 'skill';
ALTER TABLE app.resource_names DROP CONSTRAINT IF EXISTS resource_names_kind_check;
ALTER TABLE app.resource_names ADD CONSTRAINT resource_names_kind_check CHECK (kind = 'trigger');

COMMIT;
