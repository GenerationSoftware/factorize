# Skill repositories

Every workspace has a native Cloudflare Artifacts repository. Factorize reads skill files from the published Artifacts commit. Open **Skills → Git repository** to find the active remote. Each skill lives in `skills/<key>/SKILL.md` and can have supporting files alongside it.

## Native storage

Factorize edits commit to the native repository's `main` branch. **Get Git credential** issues a one-hour, repository-scoped write token. You can clone, pull, or push using the remote URL and token from the Skills page.

```sh
git -c http.extraHeader="Authorization: Bearer $ARTIFACTS_TOKEN" clone "$ARTIFACTS_REMOTE" my-skills
cd my-skills
# Edit files, commit, then push.
git -c http.extraHeader="Authorization: Bearer $ARTIFACTS_TOKEN" push origin main
```

## GitHub storage

Choose **Change repository → GitHub**, an active installation, a repository, an existing branch, and a skills folder. Confirm the replacement. Factorize publishes exactly that folder's skill directories to a fresh Artifacts mirror. An empty folder clears the active library. Skills absent from the replacement lose their saved job associations. Runs already queued keep their own file snapshots. Connecting makes no GitHub commit.

Edits through the browser, REST, and MCP commit to GitHub first. Pushes and merges update the Artifacts mirror. A protected branch can require changes through a GitHub pull request. Use **Sync now** to reconcile a missed push. If a GitHub commit succeeded but mirroring failed, reconciliation reads the GitHub head and retries publication. A failed import leaves the last published library available.

In GitHub mode **Get Git credential** issues a read-only Artifacts token for clone or pull. Push edits to GitHub. Switching back to Factorize starts a writable native repo with the currently published files. Previously issued write tokens remain scoped to their original repositories.

Each immediate subdirectory of the selected folder must have a UTF-8 `SKILL.md`. The library supports regular files, executable scripts, and binary assets, up to 8 MiB and 2,000 entries. The limit per `SKILL.md` is 100,000 characters. Agents can read the selected directories at `$FACTORIZE_SKILLS_DIR/<key>/`.

## Deployment and existing data

Apply migrations through 0063 before deploying the API, then deploy the UI. Provision the `factorize-skills` Artifacts namespace and its push Workflow. The GitHub App needs push events and Contents read access for sync, plus Contents write for edits. Installations may need to approve the permission change.

Migration 0063 queues every workspace for backfill, including workspaces that have never edited a skill. The scheduled Worker processes five workspaces per invocation and retries failures. A new workspace also enters the queue. Opening a native library or editing a skill provisions it on demand. Body-only records migrate to `SKILL.md`; existing directory records retain file bytes and executable flags. Published directories are read back and verified before replacing legacy ciphertext with Artifacts references. Existing libraries keep their repo; a verification mismatch leaves the legacy content intact for investigation.

The following read-only queries show remaining work and verification failures:

```sql
SELECT count(*) AS remaining FROM app.skill_library_backfill;
SELECT tenant_id, attempted_at, error FROM app.skill_library_backfill WHERE error IS NOT NULL;
SELECT count(*) AS skills_without_artifacts FROM app.skills WHERE artifact_version IS NULL;
```

Keep a pre-cutover database backup and retain the existing repositories through the rollback window. After migration starts, use a Worker that understands Artifacts references. An older database-only Worker needs its skill ciphertext restored before it can serve migrated records. PostgreSQL retains metadata and commit pointers for active skills, and existing immutable run snapshots continue to serve queued runs.
