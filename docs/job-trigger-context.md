# Job trigger context

Every Job trigger has a server-generated immutable slug (`trigger-1`, `trigger-2`, …). The slug is returned by REST and MCP and is preserved when a Job is edited, enabled, or disabled. New triggers receive the next unused number. A manual trigger is created for every Job.

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
| Job lifecycle | `source_job_id`, `source_run_id`, `final_state`, `transitioned_at`, `observation_destination` |

Every trigger returned by `GET /api/v1/jobs` and `GET /api/v1/jobs/:id` (and the corresponding MCP `list_jobs` and `get_job` tools) includes a `reflection` object. It contains the stable `slug`, trigger kind/provider, whether the result is dynamic, and a flat `paths` list with nested path, basic value type, description, and occasional example. The Job editor consumes this same canonical contract for Mustache autocomplete. A webhook with a replacing handler reports `dynamic: true` and an explicit `*`/`unknown` fallback because arbitrary handler output cannot be inferred safely.

Manual invocation accepts an optional display `name`, `prompt`, JSON object `data`, and `idempotencyKey`. The display name is used as the run name, while prompt and data are exposed beneath the manual trigger slug. `idempotencyKey` is the client-facing value and must not include the reserved internal `manual:` prefix. Reusing the same value returns the original invocation. Run inspection exposes that reusable value as `invocation.idempotency_key`, while `invocation.claim_key` is the internal prefixed claim and must not be passed back to the invocation API. Parameter defaults and invocation, schedule, or webhook parameter overrides are not accepted.

Run inspection returns `context` as the complete persisted object and `invocation.trigger_id` as the trigger that fired. Parameter-era stored Jobs are migrated: old context and parameters are retained beneath `legacy_context` and `legacy_parameters` in the corresponding trigger context. They are not used as global template variables.

Every webhook trigger may also define `handlerCode` containing one synchronous `function handler(webhook)` declaration. Factorize runs it only after provider authentication and trigger scoping, inside an isolated Worker with no bindings or outbound network access. Returning `false` rejects the delivery, `true` retains the default value above, and a JSON-compatible object replaces that value beneath the stable trigger slug. Timeouts, exceptions, and invalid return values are recorded in webhook activity and never create a run. REST `POST /api/v1/job-handlers/test` and MCP `test_job_webhook_handler` exercise the same isolation boundary without creating an invocation.
