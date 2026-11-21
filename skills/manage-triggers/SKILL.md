---
name: manage-triggers
description: Configure and troubleshoot Factorize scheduled, webhook and lifecycle automation for reusable skills.
---
# Manage triggers

Call `get_api_reflection` to discover permissions and integrations, then read the selected team skill and `list_skill_triggers`. Skill metadata owns execution presets, disabled state and concurrency. Automation decides when work starts; it does not replace those instructions.

## Skill automation

`get_skill_trigger({"skillId":"SKILL_UUID"})` requires `skills:read` and `triggers:read`; it returns non-manual automation or null. To save, use `save_skill_trigger` with `skills:write` and `triggers:write`:

```json
{"skillId":"SKILL_UUID","trigger":{"enabled":true,"events":[{"kind":"schedule","enabled":true,"config":{"cron":"0 9 * * 1-5","timezone":"UTC"}}]}}
```

For existing automation, read first, include `expectedUpdatedAt`, and preserve every intended event's `id`, `slug`, `kind`, `enabled`, writable `config` and optional `template`. The events array replaces the intended event configuration; omitted events are removed. Strip read-only fields. Manual events are internal compatibility details: do not add them to skill automation. Manual work uses `start_run`.

## Event choices

- Schedule: `kind: "schedule"`, `config: {cron, timezone}`. Confirm the user's timezone and intended recurrence.
- Webhook: `kind: "webhook"`; config selects `provider`. Linear needs `projectId` and nonempty `matchRules`; ClickUp needs `listId` and nonempty `matchRules`. Rules have `type` (`owner`, `creator`, `status`, `label`, `assignee`) and `targetId`.
- GitHub webhook: config contains `provider: "github"`, numeric `installationId`, `repositoryId`, and either nonempty `matchRules` or both `event` and `action`. Discover installations with `list_github_installations`; obtain actual repository/event IDs through authorized APIs/browser setup.
- Cloudflare Tail webhook: config contains `provider: "cloudflareTail"` and the saved `integrationId`; discover with `list_cloudflare_tail_integrations`.
- Lifecycle: `kind: "triggerLifecycle"`, config contains `sourceTriggerIds` and `states` chosen from `succeeded`, `failed`, `stopped`, `edited`. A trigger cannot subscribe to its own edits. Edited means a successful save, not creation or run progress.

Webhook `conditions` are optional and can be checked with `test_trigger_webhook_conditions` against representative prepared data; that test does not verify delivery/authentication or launch work. Read the saved event's slug/reflection before using Mustache paths in its `template`. Do not guess event fields. `preview_trigger_prompt` can verify the composed instructions without saving or executing.

## Existing trigger tools

Use `list_triggers`/`get_trigger` to inspect existing standalone configurations. `create_trigger` requires `triggers:write` and can bind `skillId` with named events. `update_trigger` replaces configuration: read first, preserve all intended writable fields/events, and supply `expectedUpdatedAt`. Do not pass an entire read response unchanged. Prefer skill automation tools when managing a skill's automatic events.

`enable_trigger`/`disable_trigger` toggle automation; disabling does not stop an existing run. `delete_trigger` removes future automation while retaining historical runs. `invoke_trigger` manually invokes an existing trigger using a reusable `idempotencyKey` without the internal `manual:` prefix; requires `runs:invoke`. Saved `get_trigger_invocation_permissions`/`set_trigger_invocation_permissions` control which destinations a source may invoke.

## Verify and diagnose

Reread after every save and compare intended events and enabled state. Inspect `list_runs`, `get_run`, `list_trigger_webhook_activity`, `list_webhook_deliveries` and `get_webhook_delivery` for accepted/rejected/duplicate delivery and run results. Verify schedules against timezone/cron and actual runs. Event-provider connection access and the execution agent's integration access are separate. Inspect skill disabled state, concurrency and run diagnostics before changing event rules. Automatic signals may coalesce; use authoritative runs/provider state to determine what work occurred.
