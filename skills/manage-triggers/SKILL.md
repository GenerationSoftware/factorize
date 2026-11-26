---
name: manage-triggers
description: Publish Factorize Events from manual, webhook, or scheduled Triggers.
---

Use `create_event` and `create_trigger`. Start with a manual fixture and reuse
the same idempotency key for the same fire. Verify the stored occurrence before
adding a real input. For webhook problems, start with `list_webhook_deliveries`
rather than repeating provider actions. Keep credentials in integrations.

A saved occurrence, transport receipt, and subscriber processing ACK are
different. Factorize publishes; the subscriber decides what to run.

Follow the [Event recipe](https://docs.factorize.sh/work/triggers) and
[MCP reference](https://docs.factorize.sh/mcp/tools#events-and-occurrences).
