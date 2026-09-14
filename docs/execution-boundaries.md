# Execution boundaries

Factorize separates an incoming event from the system that executes its task:

```text
provider webhook -> SourceAdapter -> WorkItem -> prompt renderer
                                               |
                                               v
Durable Object orchestrator -> ExecutionBackend -> external execution system
```

`SourceAdapter` owns provider payload normalization. It must not know about VMs,
Herdr, or a coding harness. `ExecutionBackend` owns launch, prompt delivery,
inspection, output, and stopping. The orchestrator owns durable queue, claim,
concurrency, and delivery state, but does not construct backend commands.

The current `ExeHerdrBackend` is one implementation. exe.dev supplies command
transport and VM wake-up, Herdr supplies workspace and agent supervision, and
the configured harness supplies Codex, Claude, Pi, or another Herdr-supported
agent. A future Amp implementation should implement `ExecutionBackend` without
adding Amp-specific state or commands to the orchestrator.

Launch and prompt delivery are deliberately separate operations. An existing
harness proves only that launch reconciliation succeeded. It never proves that
the run's prompt was accepted. Prompt delivery therefore has its own persisted
state and request/response receipt.
