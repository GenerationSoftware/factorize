# Factorize capability refactor

One Worker, one database, one PR. Iterate in order and record local evidence before
checking off each slice. Preserve REST/OpenAPI, MCP tools and resources,
webhook routes, OAuth behavior, migrations, storage formats, and Worker resource
identities. No production deploy, data changes, or external-provider writes
are part of validation.

- [x] **Baseline and contract harness.** Run the cloned revision in an isolated
  VM. Capture the public interface baseline and add an HTTP-to-Postgres
  characterization for Event/Trigger publication and unauthorised access.
  Acceptance: the characterization passes before moving code.
- [x] **Events and Triggers.** Colocate adapters, use cases/domain rules, and
  Postgres adapters by capability. Give the Event and Trigger API slice
  explicit use-case homes. Preserve revision checks, idempotency, and the
  atomic occurrence/outbox write. Acceptance: characterization plus Event,
  Trigger, enrichment, and transaction tests pass.
- [x] **Subscriptions.** Colocate transport, subscription lifecycle,
  acknowledgement/replay, delivery, and their DB adapters. Preserve
  authorization, lock order, leasing, retry, and acknowledgement semantics.
  Acceptance: subscription, PostgreSQL MCP delivery, and runtime tests pass.
- [x] **Proxy and credentials.** Isolate the proxy and credential boundaries;
  preserve provider selection, reauthorization, scoped response/artifact
  access, and all externally observable behavior. Acceptance: proxy and
  credential Postgres tests pass and import guards reject forbidden edges.
- [x] **Integrations, VM grants, and configuration.** Give integration and VM
  concerns capability homes, and introduce typed, scoped configuration at the
  runtime boundary without new requirements for existing deployments.
  Acceptance: VM, credential/provider settings, and config tests pass.
- [x] **Final verification.** Run the full root suite in the isolated VM and
  compare against the unchanged public and infrastructure contracts.
  Acceptance: root validation and boundary checks pass, contract files have
  no diff, and a single PR is published.

## Dependency rules

- `protected-api.ts` still owns REST registrations and MCP tool names.
  `ApiService` is their facade; new application logic belongs in a capability.
- In a capability, `api/` owns wire schemas/translation, `application/` owns
  orchestration, `domain/` owns rules that don't require Worker bindings or
  database access, and `storage/` owns the database adapters. The Event
  transaction still writes the occurrence and outbox together.
- Credential resolution is private to credential adapters and the proxy egress
  adapter; the proxy service gets a response, not a token. Provider settings
  and deployment bindings retain their existing names under `config/`.
- Add coverage against the public interface first. Avoid mixing a new public
  operation, a policy change, or a database migration into a move.

## Verification record

- Before moving code: the new Worker-to-Postgres characterization passed.
- Iteration suites: 18 Event/Trigger tests; 30 subscription and OAuth tests;
  24 proxy/credential tests; 33 provider, VM grant and configuration tests.
- Final `npm test`: all lanes passed, including 286 API tests, 55 frontend
  tests, local workerd protocol checks, OpenAPI/client drift and deployment
  invariants. The isolated VM used pinned Node/npm, disposable PostgreSQL
  and a local Chromium binary. No production credentials or data were used.
- OpenAPI, generated client, SQL migrations, and the Worker binding
  configuration have no diff from the base.
