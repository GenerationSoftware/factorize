# Execution trace stream contract

An agent launch may declare `traceSources.primary` with `kind: execution_stream`,
an absolute guest `path`, `mediaType: application/x-ndjson`, and its `provider`.
`formatVersion`, `cliVersion`, and `harnessVersion` identify the producing harness
when known. Claude may declare a separate native audit session as `nativeSession`.
Codex declares only the canonical stream and never discovers or captures a native session. Codex declares raw `codex exec --json` stdout as its primary stream with
`formatVersion: codex-exec-jsonl`; Claude declares the stream producer described below.
Pi keeps its published native session as primary; see
[Pi session contract](pi-session-contract.md).
Codex CLI version is probed in the guest at launch and persisted with the source
for run diagnostics and artifact provenance.

Normalized execution streams contain UTF-8, newline-terminated JSON objects in append order:

```json
{"version":1,"id":"event-1","type":"assistant_message","title":"Assistant","preview":"Hello","display":{}}
```

Required fields: `version` (1), `id`, `type`, `title`, `preview`. Optional fields:
`parentId`, `role`, `occurredAt` (ISO timestamp), `display` (object). Event types
match `TraceEventType` in `packages/api/src/trace.ts`. Sequence is assigned by the
projection, never trusted from the producer. Producers must append whole records
and finish each with LF. They must write human stdout/stderr to their separate
supervisor logs, never to the stream. The supervisor creates the stream directory
and file without truncating it; the harness owns JSONL serialization.

The backend tails the declared primary file in bounded byte chunks. PostgreSQL
commits offset, pending bytes, events and hash-chain receipt atomically. An
incomplete trailing line waits for a later chunk; terminal reconciliation ignores
an unterminated trailing line, preserving it in the exact artifact. Invalid
complete normalized execution records reject the chunk/projection. Codex raw
JSONL instead emits a bounded warning for malformed JSON and bounded metadata for
unknown future event/item types, then continues. Known Codex items project
reasoning, assistant text, command/MCP/web tool calls and results, file changes,
plans, lifecycle, errors and usage. Tool results reference the item call ID and
use the command or server/tool from the completion snapshot for their title.
Previews are redacted before truncation; unknown payloads are never echoed.
Retries use the same generation, offset and hash. Rename rotation starts a new
projection generation; observable same-inode truncation does likewise. Producers
must use rename rotation, never truncate and regrow between polls: an unobserved
rewrite violates the append-only contract. File descriptors pin the file identity
during each read, avoiding rename/read races.

At termination (success, failure, or stop), the exact stream snapshot is uploaded
to `trace/<sha256>.jsonl`. Codex retains exactly one `execution_stream` receipt for
`/tmp/factorize-artifacts/<run>/codex-exec.jsonl`; stderr remains a separate
`terminal_log`. Stopping terminates the writer before collecting and deleting the VM.
Reprojection reads the durable snapshot under the same run lock as live ingestion.
The receipt survives projection failure, allowing finalization to retry from retained
bytes without recapturing a mutable guest file. Later chunks are
rejected, terminal retries cannot replace the snapshot with different bytes, and
native audit uploads cannot overwrite its projection. Failed collection is retried
and ultimately reported as partial using the existing finalization policy.

Launch source declarations are persisted on the run (`trace_sources`), exposed
by run detail and diagnostics. Artifact rows retain source kind, guest path,
media type, provider, source generation, and format/CLI/harness versions where supplied.
Missing `turn.completed` in Codex stdout is recorded as
`reconciliation.codexCompletion=missing_turn_completed`, and finalization reports
`artifact_state=partial` with a specific reason, even when the process exited zero.
Reconciliation mismatches and collection/projection failures also report partial.
The UI displays that failure reason. Cleanup occurs only after bounded retries. Historical
native-only runs still use their existing provider parser and artifact semantics.

## Claude Code stdout producer (GEN-2138)

New Claude jobs run print mode with `--output-format stream-json --verbose`.
A standalone Python 3 stdlib supervisor reads the CLI's stdout JSONL and appends
Factorize v1 records to `/tmp/factorize-artifacts/<run>/claude/trace.jsonl`, flushing
every event. Python 3 is required in the guest. The CLI inherits prompt stdin and
stderr; stderr stays in `/tmp/factorize.stderr`, never in the trace. The wrapper
preserves the child exit status and forwards SIGINT/SIGTERM, recording interruption
and abnormal exits. It bounds input records at 16 MiB and previews at 32 Ki characters and display payloads at 1 MiB.
Malformed/unknown records, unknown content blocks, oversized lines and incomplete
EOF records produce diagnostic warnings rather than poisoning the projection.
A partial line waits for LF while the CLI runs. At EOF it becomes a warning.

`--forward-subagent-text` is deliberately **disabled**. Root Agent/Task calls and
results are the subagent activity visible by default; we do not invent child text
or replay transcripts into the root stream. If a CLI emits nested messages, their
`parent_tool_use_id` is preserved as `parentId`. Tool calls keep their native IDs;
all results in a user record are emitted separately with the matching name and
`parentId`, and `display.isError` retains tool failure status. System/task lifecycle
records retain their payload. Assistant and result usage remain separate usage
receipts (per-message versus total; do not sum both). The result receipt omits the
repeated final-answer text, avoiding duplicate assistant activity.
`--include-partial-messages` is also disabled to avoid duplicate delta/full-message
projection. `--json-schema` is not used.

The normalized append-only stream is the primary live source and durable terminal
artifact, so terminal reconciliation uses the same bytes, IDs and ordering as
live projection. Native project-session JSONL remains a separate audit/recovery
artifact; it cannot overwrite an accepted primary stream. Historical runs with no
persisted source declaration continue to use native discovery. Native fallback
parsing retains tool IDs, result names and error flags, including across artifact
read chunks.

`packages/api/test/fixtures/claude-2.1.293/` contains synthetic, version-pinned
schema fixtures for Claude Code 2.1.293 (the installed CLI version used during
implementation). They model default root/subagent-tool behavior, not forwarded
child text. Boundary tests execute the exact guest supervisor with a fake CLI,
including live pre-exit visibility, malformed/partial lines, UTF-8 fragmentation,
terminal reprojection, failure exits and native recovery. CLI flags follow
https://code.claude.com/docs/en/cli-reference .

## Provenance, replay, and rollout

Run diagnostics expose the declared provider/source/version, retained artifact
receipts, actual projection source/checksum/parser revision, live generation and
byte cursor, reconciliation state, warning and unknown-event counts, and explicit
native fallback use. A null projection or missing primary artifact is not proof
of completeness or recoverability. Codex native artifact state is `not_applicable`. Terminal reconciliation compares the live
projection prefix to the durable snapshot. The browser resets pagination when
its source generation or durable projection changes, including rollback.

Tenant owners can replay one terminal run's retained primary or native artifact
through `POST /api/v1/runs/{runId}/trace/replay`, using an interactive owner session
with `runs:write` and a UUID `requestId`. Native replay recovers historical Codex
custom tool calls only for historical native-only runs when native JSONL exists.
Canonical Codex runs reject `source=native_session`; they replay only their primary
stream. No migration of historical native bytes is required, and no new native
Codex artifacts are accepted. Deployment gates cannot switch new Codex launches
to native primary. Claude rollout gates and Pi native primary remain supported. Completed requests are idempotent;
failed transactions can resume; missing artifacts are reported unrecoverable.
Replay is limited to 10 requests per tenant per minute. Artifact keys are storage
locators, not download URLs. See the [rollout and incident runbook](trace-rollout-runbook.md)
for deployment gates, canary evidence, checkpointing, retention, and rollback.
