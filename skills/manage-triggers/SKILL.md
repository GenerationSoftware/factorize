---
name: manage-triggers
description: Configure input Triggers that publish durable Factorize Events.
---
# Manage Events and Triggers

Call `get_api_reflection` to inspect current identity and permissions. Events and Skills are independent: an Event describes a durable payload stream, a Trigger watches one or more input sources and publishes matching occurrences, and a Skill is a standalone instruction document.

## Events

Use `list_events` and `get_event` to inspect Events and their payload schema revisions. Create an Event with `create_event`, including a lowercase stable `name`, optional description, and JSON Schema object in `payloadSchema`. Use `update_event` with the current `expectedRevision` to add a schema revision. Existing occurrences keep their original revision. Delete Events only after removing their Triggers.

MCP subscribers read `factorize://events/{eventId}/occurrences`. Subscribe through `subscriptions/listen`; on resource update, read the occurrence resource. Occurrences are durable, so reconnecting clients can read missed records. Use `list_event_occurrences` to page through stored occurrences.

## Triggers

Each Trigger belongs to one Event; multiple Triggers may publish the same Event. Configure a Trigger with an existing `eventId`, or let the API create its initial Event. Trigger inputs can be manual, scheduled, or provider webhooks. Schedules use cron and an IANA timezone. Webhook inputs select a provider and provider-specific filters. Use `list_github_installations` and `list_cloudflare_tail_integrations` to discover saved provider setup.

Use `list_triggers` and `get_trigger` to inspect Triggers. `create_trigger` and `update_trigger` require `triggers:write`; read before editing and preserve stable IDs for input definitions. A successful input match writes one schema-validated Event occurrence. Reuse `idempotencyKey` when retrying `fire_trigger`; duplicate source deliveries do not create duplicate occurrences. `enable_trigger` and `disable_trigger` control future input processing. `delete_trigger` removes its future automation.

Webhook `conditions` are optional and can be checked with `test_trigger_webhook_conditions` against representative prepared data; this does not verify provider authentication or delivery. Use `list_trigger_webhook_activity`, `list_webhook_deliveries`, and `get_webhook_delivery` to inspect safe input-processing results.
