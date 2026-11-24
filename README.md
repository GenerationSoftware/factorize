# Factorize

Factorize stores durable Events, input Triggers, and standalone Skills. Connect an MCP client, define an Event, attach one or more Triggers, and subscribe to its occurrence resource.

Start at [app.factorize.sh](https://app.factorize.sh). Connect an MCP client to `https://app.factorize.sh/mcp`, approve `triggers:read` to discover Events and read occurrences, and approve `triggers:write` to manage Events and Triggers.

Ask your agent:

> Create an Event named `orders.created`, attach a manual Trigger, and publish a sample order. Subscribe to the Event and read the durable occurrence.

The client uses the documented Event and Trigger API, then reads the stored occurrence after an MCP resource update notification. Retrying a manual fire with the same idempotency key does not create a duplicate.

Read the [first Event guide](https://docs.factorize.sh/quickstart), [Trigger guide](https://docs.factorize.sh/work/triggers), and [MCP tool reference](https://docs.factorize.sh/mcp/tools). Skills remain standalone instruction documents.

## Development and validation

Use Node 24.12.0 and npm 11.19.0 from `.node-version` and `package.json`. Run `npm ci`, then `npm run dev`. The complete required local suite is `npm run test:local` on the documented Factorize validation runner image; it resets only an isolated local database and runs `npm test`. Never point validation at production or a shared database. See [the validation runner guide](docs/factorize-validation-runner.md).

The Worker is in `packages/api`, the static frontend in `packages/app`, and the generated public API contract in `packages/api-client`. Frontend code uses the same documented `/api/v1` routes as external clients. Run `npm run check:boundaries` to verify package imports.
