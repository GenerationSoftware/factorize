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
- [ ] **Proxy and credentials.** Isolate the proxy and credential boundaries;
  preserve provider selection, reauthorization, scoped response/artifact
  access, and all externally observable behavior. Acceptance: proxy and
  credential Postgres tests pass and import guards reject forbidden edges.
- [ ] **Integrations, VM grants, and configuration.** Give integration and VM
  concerns capability homes, and introduce typed, scoped configuration at the
  runtime boundary without new requirements for existing deployments.
  Acceptance: VM, credential/provider settings, and config tests pass.
- [ ] **Final verification.** Run the full root suite in the isolated VM and
  compare against the unchanged public and infrastructure contracts.
  Acceptance: root validation and boundary checks pass, contract files have
  no diff, and a single PR is published.
