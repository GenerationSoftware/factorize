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

`ExeHerdrBackend` and `AmpBackend` implement this boundary. exe.dev supplies command
transport and VM wake-up, Herdr supplies workspace and agent supervision, and
the configured harness supplies Codex, Claude, Pi, or another Herdr-supported
agent. Amp cloud runs persist an opaque thread handle and expose the canonical
Amp thread URL. Amp does not declare output retrieval, so Factorize does not
ingest thread contents. Amp credentials are dashboard-only; REST and MCP expose
only non-secret target metadata and capabilities.

Launch and prompt delivery are deliberately separate operations. An existing
harness proves only that launch reconciliation succeeded. It never proves that
the run's prompt was accepted. Prompt delivery therefore has its own persisted
state and request/response receipt.

## Job invocation boundary

A `Job` owns a Mustache prompt template, an execution
target, a positive concurrency limit, enabled state, and a collection of
`Trigger` records. Stored triggers are `manual`, `schedule`, `webhook`, or
`jobLifecycle`.

Trigger adapters do only source-specific authentication and normalization. They
then call the same `InvocationService.invoke(jobId, request)` operation. Its
canonical request carries the source, firing trigger ID, structured context, a
durable claim key, and optional occurrence metadata. The invocation boundary
validates and renders the prompt,
encrypts the rendered prompt, and persists the durable occurrence claim. An
automatic signal creates a queued `JobRun` only when the Job has no pending or
active automatic run; otherwise it marks one bounded trailing wake. The
`(job_id, claim_key)` constraint keeps every source retry idempotent and
lifecycle delivery also claims `(trigger_id, source_run_id, terminal_state)`.

Queue consumers call `startIfCapacity`; concurrency is counted by job, never by
trigger source. Provider adapters must not render prompts, insert runs, claim
capacity, or launch execution backends themselves.
