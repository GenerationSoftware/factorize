# Execution trace stream contract

An agent launch may declare `traceSources.primary` with `kind: execution_stream`,
an absolute guest `path`, `mediaType: application/x-ndjson`, and its `provider`.
`formatVersion`, `cliVersion`, and `harnessVersion` identify the producing harness
when known. Declare the native audit session separately as `nativeSession`;
native discovery commands remain supported. Codex declares raw `codex exec --json` stdout as its primary stream with
`formatVersion: codex-exec-jsonl`; Claude retains native-primary compatibility.
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
match `TraceEventType` in `packages/app/src/trace.ts`. Sequence is assigned by the
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
