---
name: manage-presets
description: Configure Factorize VM, permission and model presets and team defaults before delegating work.
---
# Manage presets

Use this workflow to inspect or change reusable execution configuration. Call `get_api_reflection` first to learn the current identity, scopes and integration access; then `get_team` and `list_presets`. Use returned IDs and slugs. Never invent an integration ID or request credentials from the user when a connected integration is available.

## Discover and choose

`list_presets({})` returns `presets`, each with `id`, `kind`, immutable `slug`, display `name`, `revision`, `isDefault` and `settings`. Kinds are `vm`, `permission` and `model`. Read operations require `integrations:read`; `get_team` requires `team:read`. Missing choices inherit team defaults. Inspect defaults before creating duplicates.

- VM settings: `provider: "none"` for no workspace; `provider: "exe"` with `connectionId`, optional `image` and `tags`; or `provider: "fly"` with `image`, `region` and `size`. Discover exe.dev connections with `list_exe_connections`; use reflection for provider integrations. Credential setup belongs in the browser. A workspace hosts commands; the managed agent runs in Factorize.
- Permission settings: `runScopes`, `portableIntegrationIds`, `githubInstallationIds`, `linearConnectionId`, `xConnectionIds`, and `allowedTriggerIds` as needed. Application scopes and upstream integration access are separate. Select the minimum needed; access granted to a run cannot exceed its caller's authorization.
- Model settings: `modelAccountId`, `model`, optional `effort`. The account is independent of the VM provider. Select an existing connected model account and supported model/effort.

## Create, edit and set defaults

Creating/updating requires `integrations:write`; permission presets also require `triggers:write`. Example without a VM:

```json
{"kind":"vm","slug":"no-workspace","name":"No workspace","settings":{"provider":"none"}}
```

Pass that object to `create_preset`. To edit, read the current preset with `list_presets`, then call `update_preset` with `presetId` and `preset` containing the complete intended `kind`, unchanged `slug`, `name`, `settings`, and `expectedRevision` from the read. Slugs are immutable, lowercase letters/digits separated by single hyphens, unique per kind/team. A successful edit creates a new immutable revision. On stale revision, reread and reconcile rather than overwriting someone else's changes.

`set_default_preset({"presetId":"RETURNED_ID"})` requires `team:write` and changes the default for that preset's kind. This affects future inherited runs. Do not change a team-wide default merely to configure one run: use `start_run` overrides `vmPreset`, `permissionPreset`, `modelPreset` (slugs), or skill frontmatter.

## Verify and remove

Read `list_presets` and `get_team` after a write; verify settings, revision and default selection. Existing accepted runs retain the resolved preset revisions and skill commit; later edits do not reconfigure them.

`delete_preset({"presetId":"RETURNED_ID"})` requires `integrations:write`. Defaults and presets referenced by skills cannot be deleted. Inspect the blocking references and replace the default/references deliberately before retrying. Historical run snapshots survive preset deletion. If a create response is lost, rediscover the immutable slug before creating again.
