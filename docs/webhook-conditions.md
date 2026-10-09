# Webhook conditions

Webhook trigger configuration accepts optional `conditions`, a json-rules-engine
condition tree, not a full rule/engine configuration. No conditions means no
additional filtering. `all`, `any`, and `not` compose leaf conditions; empty groups
are invalid. Invalid configuration or evaluation failures never create a run.
Provider authentication, scope/event/action selection and matchRules still apply.

```json
{"all":[{"fact":"webhook","path":"$.check_suite.conclusion","operator":"equal","value":"success"},{"fact":"webhook","path":"$.check_suite.head_branch","operator":"startsWith","value":"feature/"}]}
```

`webhook` is the only fact. It contains the prepared context the job receives:
original provider fields, provider/event/delivery_id metadata, and existing
Linear `issue`/ClickUp `task` aliases. Tail context has already been sanitized.
Delayed GitHub dequeue verification still checks an open PR targeting main,
retries unresolved mergeability, and only proceeds on confirmed conflict. Its
prepared pull_request includes verified mergeable=false and mergeable_state.
Conditions use the latest trigger configuration and never transform context.

JSONPath supports `$`, ordinary `.property` and quoted bracket properties,
array indexes `[0]`, and wildcards `[*]`/`.*`. No recursive descent, slices,
unions, filters, scripts or executable expressions are accepted; expression
evaluation is disabled. A scalar path returns its selected value (including an
array when selecting an array field). A wildcard path always returns an array
of matches, even for zero or one match. Missing scalar paths yield undefined.
`notEqual` may match missing fields; null and missing are distinct. Malformed
paths are configuration errors, not non-matches.

| Operator | Configured value | Semantics |
| --- | --- | --- |
| equal / notEqual | string, number, boolean or null | Strict scalar equality/inequality; string IDs differ from numeric IDs |
| lessThan / lessThanInclusive / greaterThan / greaterThanInclusive | finite number | Both operands must be finite numbers; strings/null/missing do not match |
| in / notIn | array of scalar values | Strict membership/non-membership of the selected value in the configured array |
| contains / doesNotContain | scalar | Strict array membership/non-membership; a non-array selected value does not match |
| startsWith | string | String prefix; missing/null/non-string selected values do not match |

Boolean negation follows the library semantics: `not` negates a valid result,
including a non-match due to a wrong operand type. No existence operator is
introduced. Conditions are limited to 16,384 serialized UTF-8 bytes, depth 16
(root counts as 1), 128 nodes, and 512 characters per path. User priorities,
fact references in values, callbacks and network facts are rejected.

The editor provides conditions JSON and prepared-example JSON textareas.
POST `/api/v1/job-conditions/test` and MCP `test_job_webhook_conditions` accept
`{conditions?, webhook}` with flows:write authorization. The context is limited
to 262,144 serialized bytes; the HTTP request is limited to 300,000 bytes.
They return `decision: match | no-match | error` plus plain JSON result details.
Configuration/request validation errors return a validation error. Details with
no `result` were not evaluated, and must not be displayed as failed. The preview
does not authenticate the example, route events, verify live GitHub state, or
invoke jobs. Runtime activity stores only concise decisions, never these values.

## Explicit GEN-2158 cutover

Migration 0013 inventories **every stored trigger**, including disabled and
removed triggers. It recognizes only the exact reviewed Build Manager source,
job ID and trigger slug/event/action. Any additional or changed handler aborts
the transaction for explicit review; no arbitrary JavaScript is translated.
It records prior enabled state, disables affected triggers, removes the legacy
property and installs the three exclusion groups in
`packages/api/migrations/build-manager-conditions.json`. Absent check_suite
matches, preserving the old early return for selected completed events.
Trigger identity, routing and prompt context stay intact. A database constraint
rejects future writes of the removed property.

Before production, validate on an isolated Neon branch and inventory again.
The production workflow migrates before deploying the conditions Worker, then
runs `restore-webhook-conditions.mjs` only after deployment. The public session
response's `X-Factorize-Webhook-Conditions: v1` marker gates restoration. On any
migration/deployment/verification failure, affected triggers remain disabled.
Restoration rejects changed conditions or prematurely enabled triggers and
restores the recorded prior enabled state transactionally. After deployment,
verify the canonical authenticated preview on exclusion/accepted examples,
trigger identity/configuration/enabled state, and no stored legacy property.
Do not deploy the old runtime over the converted data: disable migrated triggers
first if a backend rollback becomes necessary. A frontend-only rollback must
retain the conditions API/runtime.
