# GEN-2156 validation

Mutation state lives outside replaceable controls. Job/run/settings reads capture a generation and discard results if a mutation has started or completed since the read began. Requested refreshes are queued while a poll is busy and resume after visibility/focus restoration. Confirmed mutation responses acknowledge enable and stop immediately; background read errors are separate from mutation errors.

Both Run paths retain the logical submission's idempotency key on retries, close the prompt dialog immediately, retain its draft, and display an explicitly unaccepted pending request. A new input creates a new logical submission. Navigation waits for the canonical run ID. Keys persist for the lifetime of the page, including polling rerenders; a full page reload does not retain an unresolved submission.

Kill remains the existing stop request API. Availability is restricted to starting/running/blocked. Queued, stopping, and terminal states have no Kill control. History remains visible; stopping does not claim immediate termination.

Scheduler wake remains awaited for REST and MCP. This change makes no claim of server latency improvement and introduces no asynchronous notification or recovery mechanism.

## Controlled timing comparison

Measured on 2026-10-09 by executing the generated job detail browser scripts from main (4afa350) and this implementation in happy-dom with Vitest fake timers. The enable POST fixture takes 200 ms before a simulated awaited wake of 400 ms; GET fixtures take 200 ms. The benchmark sampled the rendered button each millisecond. These are injected timings, not production measurements or measurements of a real Durable Object.

| Metric | Main | Implementation |
| --- | ---: | ---: |
| Simulated mutation request duration | 600 ms | 600 ms |
| Simulated awaited wake duration | 400 ms | 400 ms |
| Click to visible enable feedback | 800 ms | 0 ms |
| Click to confirmed enable state | 800 ms | 600 ms |

The retained browser regression asserts immediate Starting feedback with a delayed 600 ms invocation response and navigation only after confirmation. Request and wake durations remain unchanged by design. Production request/wake timing should be measured independently before changing scheduler delivery.

## Automated validation

`npm run check --workspace=factorize` runs generated OpenAPI verification, API boundary checks, auth-email script tests, TypeScript, Vitest, and a Wrangler deployment dry run.

Browser coverage executes generated scripts with delayed responses, changing polling snapshots, older reads resolving after mutation completion, uncertain outcomes, retries, prompt recovery, all stop-availability states, artifact-cleaning deletion, token creation/revocation, client disconnection, integration removal, and connection testing. Existing REST/MCP manual invocation replay tests exercise server idempotency.

PostgreSQL integration suites require their configured test database and are skipped when it is absent. No production credentials, connections, jobs, or database contents are modified by validation.
