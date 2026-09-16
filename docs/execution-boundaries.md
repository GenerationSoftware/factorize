# Execution boundaries

Factorize separates an incoming trigger from the system that executes its job:

```text
provider webhook -> SourceAdapter -> WorkItem -> prompt renderer
                                               |
                                               v
Durable Object orchestrator -> ExecutionBackend -> external execution system
```

`SourceAdapter` owns provider payload normalization. It must not know about VMs
or a coding harness. `ExecutionBackend` owns launch, inspection, and stopping.
Prompt delivery, output retrieval, and recovery are declared capabilities, not
requirements. The orchestrator persists the backend kind, its opaque handle,
capabilities, and observation destination URL; it never interprets the handle.

Backends map their native lifecycle into `queued`, `starting`, `running`,
`blocked`, `stopping`, `stopped`, `succeeded`, or `failed`. Historical `done`,
`recovering`, and `cancelled` rows are presented as `succeeded`, `starting`, and
`stopped` respectively, avoiding a risky rewrite of durable history.

The current `ExeHerdrBackend` is one implementation. exe.dev supplies command
transport and VM wake-up, Herdr supplies workspace and agent supervision, and
the configured harness supplies Codex, Claude, Pi, or another Herdr-supported
agent. A future Amp implementation should implement `ExecutionBackend` without
adding Amp-specific state or commands to the orchestrator.

Launch and prompt delivery are deliberately separate operations. An existing
harness proves only that launch reconciliation succeeded. It never proves that
the run's prompt was accepted. Prompt delivery therefore has its own persisted
state and request/response receipt.

## Job invocation boundary

A `Job` owns a Mustache prompt template, string parameter defaults, an execution
target, a positive concurrency limit, enabled state, and exactly one `Trigger`.
Triggers have one of three domain kinds: `manual`, `schedule`, or `webhook`.

Trigger adapters do only source-specific authentication and normalization. They
then call the same `InvocationService.invoke(jobId, request)` operation. Its
canonical request carries the source, optional reserved `context`, string
parameter overrides, a durable claim key, and optional occurrence metadata.
The invocation boundary validates and renders the prompt, applies defaults,
encrypts the rendered prompt, and atomically persists an `Invocation` plus its
queued `JobRun`. The `(job_id, claim_key)` constraint makes retries idempotent.

Queue consumers call `startIfCapacity`; concurrency is counted by job, never by
trigger source. Provider adapters must not render prompts, insert runs, claim
capacity, or launch execution backends themselves.
