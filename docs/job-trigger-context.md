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
| Manual | `prompt`, `data` |
| Schedule | `occurredAt`, `externalId`, `metadata.timezone` |
| Linear webhook | Complete Linear delivery, plus `provider`, `event`, `delivery_id` |
| GitHub webhook | Complete GitHub delivery, plus `provider`, `event`, `delivery_id` |
| Cloudflare Tail | Complete sanitized Tail delivery, plus `provider`, `event`, `delivery_id` |
| Job lifecycle | Terminal: `sourceJobId`, `sourceRunId`, `state`, `completedAt`; edited: `source_job_id`, `event`, `edited_at` |

Every trigger returned by `GET /api/v1/jobs` and `GET /api/v1/jobs/:id` (and the corresponding MCP `list_jobs` and `get_job` tools) includes a `reflection` object. It contains the stable `slug`, trigger kind/provider, whether the result is dynamic, and a flat `paths` list with nested path, basic value type, description, and occasional example. The Job editor consumes this contract for Mustache autocomplete. Current terminal lifecycle reflection still advertises older snake_case fields; the scheduler emits the camelCase fields above, so inspect persisted context when verifying templates. Webhook conditions preserve normal provider context reflection.

Manual invocation accepts an optional display `name`, `prompt`, JSON object `data`, and `idempotencyKey`. The display name is used as the run name, while prompt and data are exposed beneath the manual trigger slug. `idempotencyKey` is the client-facing value and must not include the reserved internal `manual:` prefix. Reusing the same value returns the original invocation. Retain the submitted key. Current run inspection does not expose `invocation.idempotency_key`; `invocation.claim_key` is the internal prefixed claim and must not be passed back to the invocation API. Parameter defaults and invocation, schedule, or webhook parameter overrides are not accepted.

Run inspection returns `context` as the complete persisted object and `invocation.trigger_id` as the trigger that fired. Parameter-era stored Jobs are migrated: old context and parameters are retained beneath `legacy_context` and `legacy_parameters` in the corresponding trigger context. They are not used as global template variables.

Webhook triggers may define optional declarative `conditions`; they filter without replacing context. See [webhook conditions](webhook-conditions.md) for operators, JSONPath, limits and preview behavior.

Prompt and run-name templates render plain text: double-brace substitutions preserve URLs, quotes, Markdown, and code without HTML entity escaping. Triple-brace substitutions remain supported. Literal entity text in job context is preserved, not decoded. The web UI escapes rendered values when displaying them. This applies to new runs; existing persisted prompts are unchanged.

Object and array substitutions insert compact JSON, including nested values: `{{trigger-1}}` inserts the complete trigger context and `{{trigger-1.data}}` inserts the complete manual data object. Object keys are sorted recursively (integer keys follow JSON's numeric ordering); array order is preserved. Nested nulls render as JSON `null`; a directly interpolated null or missing value remains empty, as in Mustache. Primitive values remain raw text. Sections still use the original context for truthiness, object scopes, and array iteration.
