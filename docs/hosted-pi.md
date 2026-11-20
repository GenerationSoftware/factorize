# Hosted Pi execution

Factorize bundles `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` at 1.5.2. The managed runtime runs in the Worker with Node compatibility, using the selected OpenAI Chat Completions adapter. Guest images do not install or launch managed agents. VM scripts retain their separate execution lifecycle. Worker identity, database, scheduler, and storage bindings are unchanged.

A model integration stores an OpenAI-compatible provider base URL and optional API key, encrypted by the existing managed credential repository. The model ID belongs to Team defaults or the Trigger/run override. Model and VM catalogs are independent. Optional context/output limits control the framework request and compaction threshold. A keyless integration sends no Authorization header. Credentials are resolved anew for each scheduler turn; they never enter agent messages.

PostgreSQL owns encrypted session checkpoints, a stream event journal, tool-call records, framework version, lease epochs, and turn/compaction counts. A scheduler tick runs one complete Pi turn, including its tool batch, then releases the lease and schedules continuation. The framework owns provider streaming, tool execution, message conversion and cancellation. Compaction uses a framework model call and retains the original journal. The public trace projection uses the same tenant-scoped trace table as historical traces.

Leases last 90 seconds and are renewed every five seconds during execution. Every session write checks the lease epoch and authoritative active run state. Cancellation invalidates access and aborts an active provider stream. A fresh worker restores the last complete checkpoint; partial streaming records remain in the journal. Finalization is idempotent after the completed-session boundary. Interrupted tool outcomes require explicit reconciliation rather than an assumed success.

Migration 0073 retains historical run configurations and trace bytes. It records retired Team/Trigger agent selections as configuration diagnostics and makes Pi canonical for future Trigger execution. Existing subscription credentials remain stored, but require replacement with a compatible provider URL/key before new managed runs. Retired device authorization and guest harness selection are absent from the public contract. Script runs remain VM workloads.

Local validation uses an actual bundled Pi and an isolated PostgreSQL database with a deterministic OpenAI-compatible HTTP server. It covers streaming, tools, compaction, provider errors, keyless requests, restart continuation, competing leases, cancellation, and scheduler launch without a guest backend. No live provider account or deployment is required.

Agent runs default to `requiresVm: false`. Scripts always require a VM. Direct
runs resolve an explicit VM configuration before the Team default; an explicit
configuration implies `requiresVm: true` unless the request contradicts it, which
is rejected. A required missing or unavailable configuration fails admission or
provisioning. An unused Team VM default does not affect a VM-free run. Triggers
copy their VM requirement/configuration at creation.

A remote workspace is provisioned separately from Pi. PostgreSQL stores a fenced
provisioning receipt, selected integration epoch, exact provider handle and an
encrypted random guest proof before work begins. Readiness and ownership are
verified before the first model turn and subsequent turns/commands. The MCP
`get_api_reflection` tool reports `agentHost: factorize` and a verified
`current_vm`, or null. `vm_exec` executes only in the active run's server-bound
workspace; it accepts a command and optional absolute cwd, never a VM identifier.
External identities without a bound run cannot use it. Workspace access does not
grant account-wide provider API access. Provider disconnection/reconnect cannot
restore an old workspace grant. Cleanup retains independent receipts through
cancellation, late provisioning, partial provider failures and run deletion.

exe.dev uses its documented HTTPS command API and NDJSON command stream with an
explicit exit status. Fly uses the Machines API and guest exec. Neither provider
installs or launches Pi or another managed agent in the guest.

`start_run` returns an admission receipt immediately. Hosted execution is driven
by a dedicated durable alarm per run, independent of the global admission and
maintenance alarm. PostgreSQL leases and epochs fence all model, MCP and journal
writes. A replacement worker resumes the last complete checkpoint; unfinished
stream tokens do not authorize tool effects.

Each tool call commits its validated arguments before execution and its encrypted
result before returning to Pi. Recovery reuses completed results and resolves
missing batch entries through the framework's tool runner. `start_run` and
`invoke_trigger` receive stable server-generated idempotency keys, including
when a response is interrupted. Read-only operations may retry. An unconfirmed
mutating operation (including a VM command) blocks with `pi_tool_uncertain`, its
call ID and a diagnostic. It is not repeated automatically. Canceling a blocked
run still removes its workspace. No endpoint silently resumes uncertain effects.

Media uses the pinned Pi content contract: text and images. Pi 1.5.2 does not
accept audio or video blocks. Factorize performs no decoding, resizing,
transcoding or MIME guessing; provider format/capability errors remain visible.
Reflection reports these capabilities. Uploads are capped at 32 MiB each and a
model turn at 16 MiB of decoded image bytes, bounding Worker memory use.

Use POST /api/v1/media/uploads with mediaType, byteSize, SHA-256 and an
idempotencyKey; PUT the raw bytes to its uploadUrl with the declared Content-Type.
Pass attachments: [{artifactId}] to start_run or POST /api/v1/runs. A run can have
up to 16 input images and can start with images alone. The dashboard Start run
form uses these same endpoints. Upload retries reuse the receipt and immutable
metadata; changing metadata under the same key conflicts. Streaming counts and
hashes bytes and commits only after R2 confirms the write. Independent upload
attempt receipts retain unadopted objects for cleanup.

MCP fetch_media accepts an authorized integration, relative GET path, optional
headers and idempotencyKey. It follows ordinary proxy authorization and returns
a media reference. read_media returns standard MCP image content. Hosted Pi
stores only references in checkpoints, tool journals and stream events, then
loads original bytes at the framework/provider boundary. Inputs and scratch
remain isolated by Team and active run; one run cannot choose another run's
scratch. No credentials are included in references. Uploaded/fetched media never
creates a published-output or artifact-promotion feature.

Media cleanup follows reachability. Input images and artifact references actually
included in the structured final result stay with the run's retained history.
There is no promotion endpoint: result references are retained automatically as
part of that result. Other media is scratch, protected throughout execution and
for one hour after termination. Unattached uploads expire after 24 hours. Deleting
run history removes its media links and makes otherwise unreferenced blobs
eligible for cleanup. Private proxy buffers used only by fetch_media expire as
soon as capture finishes.

Cleanup claims PostgreSQL leases before R2 deletion, stops new reads/attachments,
and retries partial failures. Independent object-attempt tombstones repeat
confirmed deletions for 24 hours to cover ambiguous or late writes. Active upload
leases and images shared with retained inputs/results remain protected. The
existing RUN_HISTORY_RETENTION_PAUSED setting also pauses media expiry. VM
resource finalization continues while history retention is paused.

Runs retain their editable display name. Source is the Trigger name captured at
admission, or manual for direct runs; it remains stable after rename/deletion.
Prompt shows an optional /skill name plus a bounded literal-context preview, or
the shortened script for script runs. Skill instructions remain part of the full
harness input, with a separate full context snapshot for detail clients. New
preview/context snapshots are encrypted; list reads are bounded to a page and do
not assemble full invocation/trace data. Historical runs retain their accepted
prompt and original resource snapshots.
