---
name: run-and-supervise
description: Launch Factorize skills or ad hoc work, supervise execution, listen for completion and retrieve verified results.
---
# Run and supervise work

Follow through on delegated work: starting a run is not completion. Call `get_api_reflection`, `get_team`, `list_presets`, and, when selecting reusable instructions, `list_skills`/`get_skill`. Read current tool schemas and discovered IDs. Check the required model, workspace and integration permissions before dispatch.

## Prepare and launch

`start_run` requires `runs:start`. Supply at least an effective prompt, selected skill or attachment. Example:

```json
{"skill":"review-changes","prompt":"Review the requested repository changes and report test evidence.","name":"Review requested changes","idempotencyKey":"UNIQUE_KEY_FOR_THIS_INTENT"}
```

An ad hoc run can omit `skill` and supply `prompt`. Optional `inputs` provide structured run context. Select preset slugs using `vmPreset`, `permissionPreset`, `modelPreset`; otherwise skill choices and team defaults apply. A VM preset can provide an exe.dev or Fly.io workspace, or no workspace. `requiresVm` explicitly controls workspace requirements where applicable. Do not send retired scripts: instruct the agent to execute code instead.

Use a stable idempotency key for retries of the same intended launch; a different task gets a new key. Preserve the returned `runId`, browser `url`, `outcomeUri`, and `duplicate`. A lost response must not cause duplicate work. Resolved preset revisions and the skill commit are frozen before queueing. Later edits/default changes do not alter accepted work. Disabled skills reject new work; concurrency and team capacity may leave a run queued. Caller permissions bound the run's access.

## Supervise and receive completion

Use `get_run({"runId":"RETURNED_ID"})` (`runs:read`) for authoritative state, rendered prompt, context, activity and output. `list_runs` supports filtering/pagination, including `skillId`. Do not treat a successful launch, progress message or quiet stream as a successful task result.

For clients implementing MCP subscriptions, persist the outcome URI and conversation association. Send `subscriptions/listen` with:

```json
{"notifications":{"resourceSubscriptions":["RETURNED_OUTCOME_URI"]}}
```

On `notifications/subscriptions/acknowledged` and `notifications/resources/updated`, call `resources/read` on that URI and parse its JSON text. A pending outcome is not terminal; a committed outcome has an `eventId`. Reconnect when a stream closes and reread after acknowledgment so completion before/during connection is not lost. Deduplicate delivery by `eventId`. A host adapter must keep listening and deliver the result to the conversation; instructions alone cannot add background notification support to a client. The repository's `scripts/watch-run.mjs` demonstrates that adapter.

If subscriptions/resource access are unavailable in the client, use bounded `get_run` checks while actively working, or return the run link and explain that status must be checked later. Never promise an automatic notification without a supported listener. After a terminal event, read `get_run` to retrieve authoritative output and report success, failure or cancellation with evidence and limitations.

## Diagnose and intervene

`get_run_diagnostics` requires `runs:read` and explains credential-safe launch, delivery, output and cleanup failures. `rename_run` requires `runs:write`; use `expectedName` to reject stale edits. `report_run_error` records a reason for an active run without stopping it. Use `stop_run` or `kill_run` with `runs:cancel` when stopping work is requested. Verify terminal state afterward; cleanup may continue asynchronously.

Managed agents receive their accepted skill as pinned `skill://runs/...` resource URIs, including supporting files. Read those supplied URIs rather than substituting the current team document. They remain isolated to the active owning run even without broad `skills:read`. Managed `vm_exec` operates only on that run's bound workspace; external conversation VMs use the environment/grant workflow instead.
