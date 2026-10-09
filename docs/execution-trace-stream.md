# Execution trace stream contract

An agent launch may declare `traceSources.primary` with `kind: execution_stream`,
an absolute guest `path`, `mediaType: application/x-ndjson`, and its `provider`.
`formatVersion`, `cliVersion`, and `harnessVersion` identify the producing harness
when known. Declare the native audit session separately as `nativeSession`;
native discovery commands remain supported. Codex retains a native primary until
its stream producer is implemented. Claude declares the stream producer described
below. Pi keeps its published native session as primary; see
[Pi session contract](pi-session-contract.md).

Execution streams contain UTF-8, newline-terminated JSON objects in append order:

```json
{"version":1,"id":"event-1","type":"assistant_message","title":"Assistant","preview":"Hello","display":{}}
```

Required fields: `version` (1), `id`, `type`, `title`, `preview`. Optional fields:
`parentId`, `role`, `occurredAt` (ISO timestamp), `display` (object). Event types
match `TraceEventType` in `packages/app/src/trace.ts`. Sequence is assigned by the
projection, never trusted from the producer. Producers must append whole records
and finish each with LF. They must write human stdout/stderr to their separate
supervisor logs, never to the stream. The supervisor creates the stream directory
and file without truncating it; the harness owns JSONL serialization.

The backend tails the declared primary file in bounded byte chunks. PostgreSQL
commits offset, pending bytes, events and hash-chain receipt atomically. An
incomplete trailing line waits for a later chunk; terminal reconciliation ignores
an unterminated trailing line, preserving it in the exact artifact. Invalid
complete execution records reject the chunk/projection rather than create events.
Retries use the same generation, offset and hash. Rename rotation starts a new
projection generation; observable same-inode truncation does likewise. Producers
must use rename rotation, never truncate and regrow between polls: an unobserved
rewrite violates the append-only contract. File descriptors pin the file identity
during each read, avoiding rename/read races.

At termination (including process failure), the exact stream snapshot is uploaded
to `trace/<sha256>.jsonl`, separately from `native/session.jsonl`. Reprojection
reads that durable snapshot. Its stored artifact receipt and final projection
commit together under the same run lock as live ingestion. Later chunks are
rejected, terminal retries cannot replace the snapshot with different bytes, and
native audit uploads cannot overwrite its projection. Failed collection is retried
and ultimately reported as partial using the existing finalization policy.

Launch source declarations are persisted on the run (`trace_sources`), exposed
by run detail and diagnostics. Artifact rows retain source kind, guest path,
media type, provider, format/CLI/harness versions where supplied. Historical
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

`packages/app/test/fixtures/claude-2.1.293/` contains synthetic, version-pinned
schema fixtures for Claude Code 2.1.293 (the installed CLI version used during
implementation). They model default root/subagent-tool behavior, not forwarded
child text. Boundary tests execute the exact guest supervisor with a fake CLI,
including live pre-exit visibility, malformed/partial lines, UTF-8 fragmentation,
terminal reprojection, failure exits and native recovery. CLI flags follow
https://code.claude.com/docs/en/cli-reference .
