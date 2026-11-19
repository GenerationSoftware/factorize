# Skill repositories

Open **Skills → Connect Git repository**. Factorize-managed libraries use the
`main` branch and `skills/<key>/SKILL.md`. A first skill edit with Artifacts
enabled also creates a managed library and seeds the current skills. Existing
job links, literal prompt bodies and revision checks continue to work.

**Get Git credential** issues a one-hour write token for the selected managed
repository. Copy the remote and token from the Skills page. For example:

```sh
git -c http.extraHeader="Authorization: Bearer $ARTIFACTS_TOKEN" clone "$ARTIFACTS_REMOTE" my-skills
cd my-skills
# Edit skills/<key>/SKILL.md and its supporting files, then commit.
git -c http.extraHeader="Authorization: Bearer $ARTIFACTS_TOKEN" push origin main
```

For GitHub, select an active installation, repository, branch and dedicated
skills folder. Each immediate subdirectory must contain a UTF-8 SKILL.md.
Choose a branch with at least one commit. The initial connection publishes
its skills and commits any existing Factorize skills missing from that folder
to GitHub. A protected or read-only branch can be seeded through a PR before
connecting. Repo pushes and merges update the published library.
Factorize editor, REST and MCP changes commit to the selected branch; a
protected branch can require users to make changes through a PR on GitHub.
Switching sources creates a fresh Artifacts repo. The previous repo retains
its history and no longer publishes to this library.

A library accepts regular files, including executable scripts and binary
assets, up to 8 MiB total and 2,000 entries. Managed synchronization uses
a shallow fetch limited to 16 MiB. The existing 100,000-character limit
applies to each SKILL.md. A move of an entire, uniquely identifiable skill
directory preserves job references. Use the Factorize editor to rename a
referenced skill and change its instructions together. Invalid commits leave
the last accepted version active. Fix the branch and push again or use
**Sync now**. Queued runs retain their selected file bytes and commit.
Agents can read `$FACTORIZE_SKILLS_DIR/<key>/` at launch.

## Deployment

Apply migration 0062 before deploying the Worker. Provision the Artifacts
namespace `factorize-skills` before deployment. The Wrangler configuration registers the
`factorize-skill-push` Workflow for pushes in that namespace. The Workflow
publishes the managed repository’s main branch.
The scheduled reconciliation retries missed events. Configure the existing
GitHub App to subscribe to push events with Contents read access, and grant
Contents write access for editor commits. Existing installations may need
to approve the permission change. Deploy the additive v1 API before the UI.
