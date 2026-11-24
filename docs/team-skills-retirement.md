# Team Skills retirement

The release removes team Skills access and stops provisioning and syncing
libraries. Migration `0103_remove_team_skills` disables new tenant backfills and
removes retired scopes from existing grants and presets. Stored Skills, their
cache, and Git history remain available for the later purge. MCP continues to
publish the built-in `manage-triggers` guide.

Once the retiring Worker is live, run the database purge using the release
database connection. It drops the retired tables and Git credentials and
releases names held by team Skills.

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/api/scripts/purge-team-skills.sql
```

Use the release account's `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` to
review the Artifacts inventory and apply the repository purge.

```sh
node scripts/purge-skill-artifacts.mjs
node scripts/purge-skill-artifacts.mjs --apply
```

The repository purge removes Git history from `factorize-skills`, including
original libraries, replacements, and mirrors. It checks that the namespace is
empty. Both purge commands can be rerun after interruption. Customer GitHub
repositories sit outside this namespace. The namespace and Worker bindings
stay in place through this release. For rollback after the purge, use a Worker release that runs without the
team Skills tables.

The repository purge uses the [Cloudflare Artifacts REST API](https://developers.cloudflare.com/artifacts/api/rest-api/).
