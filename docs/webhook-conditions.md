# Webhook conditions

Webhook Trigger configuration accepts optional `conditions`, a
json-rules-engine condition tree rather than a full engine configuration. No
conditions means no additional filtering. `all`, `any`, and `not` compose leaf
conditions; empty groups are invalid. Invalid configuration or evaluation
failures do not publish an Event occurrence. Provider authentication and
provider/event/action selection still apply.

```json
{"all":[{"fact":"webhook","path":"$.check_suite.conclusion","operator":"equal","value":"success"},{"fact":"webhook","path":"$.check_suite.head_branch","operator":"startsWith","value":"feature/"}]}
```

`webhook` is the only fact. It contains the prepared provider data, including
provider, event, and delivery metadata, plus normalized Linear `issue` and
ClickUp `task` fields. Tail context has already been sanitized. Conditions
filter data and do not transform the Event occurrence payload.

JSONPath supports `$`, ordinary `.property` and quoted bracket properties,
array indexes `[0]`, and wildcards `[*]`/`.*`. Recursive descent, slices, unions,
filters, scripts, and executable expressions are not accepted. A scalar path
returns its selected value. A wildcard path always returns an array. Missing
scalar paths yield undefined; null and missing are distinct.

| Operator | Configured value | Semantics |
| --- | --- | --- |
| equal / notEqual | string, number, boolean, or null | Strict scalar equality/inequality |
| lessThan / lessThanInclusive / greaterThan / greaterThanInclusive | finite number | Both operands must be finite numbers |
| in / notIn | array of scalar values | Strict membership/non-membership |
| contains / doesNotContain | scalar | Strict array membership/non-membership |
| startsWith | string | String prefix |

Conditions are limited to 16,384 serialized UTF-8 bytes, depth 16, 128 nodes,
and 512 characters per path. User priorities, fact references in values,
callbacks, and network facts are rejected.

Use `test_trigger_webhook_conditions` with representative prepared data to
preview a rule. Preview does not authenticate the example, route a delivery,
verify live GitHub state, or publish an occurrence. Inspect real outcomes with
`list_trigger_webhook_activity` and `list_webhook_deliveries`; logs contain safe
processing decisions rather than raw provider payloads.
