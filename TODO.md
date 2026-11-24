# Events and Triggers; remove Jobs, Runs, Pi, and harness

Implement the sections in order. Check a criterion only after verifying it in this checkout and the isolated local validation environment. Record the command and result. Preserve unrelated existing work. Follow `AGENTS.md`; never run validation against production or a shared database.

## Design

- An **Event** is a named, durable, subscribable object with a payload schema and occurrences.
- A **Trigger** belongs to one Event and watches an input source such as a schedule, webhook, or provider event. Multiple Triggers may belong to one Event.
- A matching Trigger emits a validated durable occurrence of its Event. It does not create an invocation, Job, Run, or agent execution.
- Duplicate deliveries from sibling Triggers produce one occurrence per Event; the same source delivery can publish a different Event independently.
- **Skills** remain standalone instruction documents, independent from Events and Triggers.
- MCP subscribers subscribe to an Event occurrence resource, receive a resource update notification, and read the durable occurrence. Reconnects can recover occurrences from stored state.
- Prefer removing obsolete execution paths and tests over adapting them. Keep only the smallest Event/Trigger and subscription implementation that meets these behaviors.

## 1. Refactor the core model and input pipeline

- [x] Make Events first-class parents of Triggers; support multiple Triggers per Event.
- [x] Preserve required schedule, webhook, and provider input handling and deduplication.
- [x] A matching Trigger creates a durable Event occurrence whose payload is validated by the Event schema.
- [x] Remove the old per-Trigger output-definition model and any invocation/queue dependency from event matching.
- [x] Skills remain independently manageable and are not required by Events or Triggers.

## 2. Expose Events, Triggers, and MCP subscriptions

- [x] Provide authorized, validated `/api/v1` operations to manage Events and their Triggers and inspect occurrences.
- [x] Document every JSON operation in `packages/docs/openapi.yaml` and regenerate `factorize-api-client`.
- [x] MCP clients can discover an Event, subscribe to its occurrence resource, receive an update after a Trigger fires, and read the occurrence.
- [x] A reconnecting subscriber can read stored occurrences; tenant authorization prevents cross-tenant access.
- [x] Frontend flows use the same documented `/api/v1` contract as external clients.

## 3. Remove Jobs, Runs, Pi, and harness

- [x] Remove Job and Run routes, MCP tools/resources, UI screens and links, run-scoped agent access, and execution code.
- [x] Remove Pi and harness runtime, scheduling, cleanup, run-only scopes, dependencies, scripts, deployment configuration, and documentation.
- [x] No Event or Trigger path creates an invocation, Job, Run, or agent execution.
- [x] A forward migration deletes existing Job/Run history, artifacts, Pi sessions, and other run-only records and drops storage no longer used by Events, Triggers, or Skills.
- [x] Old Run and Job operations are absent and unsupported after the change.

## 4. Prune obsolete tests and documentation

- [x] Delete tests exclusively covering removed Job/Run lifecycle, agent execution, Pi, harness, run media/traces, cleanup, and run-scoped authorization. Do not refactor those tests into Event tests.
- [x] Keep applicable Skills and Trigger-input tests.
- [x] Add only focused tests for Event payload validation, multiple Triggers targeting one Event, duplicate delivery handling, authorization, and MCP notification/read behavior.
- [x] Remove run-oriented MCP guidance and examples; document Event and Trigger subscription workflows.

## 5. Final verification

- [x] `npm run check:boundaries` passes. Verified: 11 boundary tests passed; frontend, generated client and API package import boundaries verified.
- [x] Search confirms no obsolete Job/Run/Pi/harness product paths or dependencies remain.
- [x] With the documented validation runner and isolated local database, `npm ci` and `npm run test:local` pass. This includes the complete root `npm test` suite. No external service account, deployment, or production data is needed.
- [x] `git diff --check` passes and every criterion above has a recorded verification result.

## Verification record

- `npm ci` completed successfully in the documented pinned validation-runner image (Node 24.12.0/npm 11.19.0).
- `npm run test:local` passed on a fresh isolated PostgreSQL database. This ran the complete root suite: 46 API test files / 198 tests, browser build and functional/unit checks, and proxy checks; all lanes passed.
- `npm run check:boundaries` passed (11 tests and import scan); `npm run generate` and `npm run validate --workspace=factorize-docs` passed.
- Product-path search found no removed Run/Job/Pi/harness routes, tools, schemas, or dependencies in current API, app, generated OpenAPI, product docs, Skills, scripts, or package manifests. `git diff --check` passed.

The pre-existing untracked `packages/api/test/event-matches.postgres.test.ts` was unavailable to recover in this checkout. Focused Event match coverage is present in the new `packages/api/test/event-match-repository.postgres.test.ts` and MCP resource coverage in `packages/api/test/mcp-skills.postgres.test.ts`.
