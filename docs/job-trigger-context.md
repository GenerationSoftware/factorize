# Job trigger context

Every Job trigger has a server-generated immutable slug (`trigger-1`, `trigger-2`, …). The slug is returned by REST and MCP and is preserved when a Job is edited, reordered, enabled, or disabled. New triggers receive the next unused number. A manual trigger is created for every Job.

Job prompts are Mustache templates rendered only against the firing trigger's structured context. Missing paths render as an empty string. For example:

```mustache
{{trigger-1.prompt}}
{{trigger-2.issue.title}}
{{trigger-3.pull_request.number}}
```

The available value beneath a slug is:

| Trigger | Fields |
| --- | --- |
| Manual | `prompt` |
| Schedule | `scheduled_at`, `cron`, `timezone` |
| Linear webhook | Complete Linear delivery, plus `provider`, `event`, `delivery_id` |
| GitHub webhook | Complete GitHub delivery, plus `provider`, `event`, `delivery_id` |
| Cloudflare Tail | Complete sanitized Tail delivery, plus `provider`, `event`, `delivery_id` |
| Custom webhook | Complete submitted JSON delivery, plus `provider`, `event`, `delivery_id` |
| Job lifecycle | `source_job_id`, `source_run_id`, `final_state`, `transitioned_at`, `observation_destination` |

Manual invocation accepts `{ "prompt": "...", "idempotencyKey": "..." }`. Parameter defaults and invocation, schedule, or webhook parameter overrides are not accepted.

Run inspection returns `context` as the complete persisted object and `invocation.trigger_id` as the trigger that fired. Parameter-era stored Jobs are migrated: old context and parameters are retained beneath `legacy_context` and `legacy_parameters` in the corresponding trigger context. They are not used as global template variables.
