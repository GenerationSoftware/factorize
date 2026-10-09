# Trace-source rollout and recovery

GEN-2140 adds deployment gates, projection receipts, diagnostics, and authorized
retained-artifact replay. A merged implementation is not production canary evidence.
Record deployment revision, tenant IDs, run IDs, timestamps, and diagnostics in the
release ticket before widening the rollout. Never paste grants or artifact payloads.

## Deployment gates

1. Apply `0011_trace_rollout.sql` before deploying the application. Keep all earlier
   migrations. This additive migration does not delete events, artifacts, or cursors.
2. Begin with `TRACE_PRIMARY_MODE=native_session`. This affects **new launches**;
   existing runs retain their declared primary through finalization. Pi remains on
   its version-pinned native session in every mode. Historical undeclared runs
   remain native. Preserve native artifacts for all stream canaries.
3. Set `TRACE_PRIMARY_MODE=execution_stream` and `TRACE_STREAM_TENANTS` to a
   comma-separated allowlist of approved canary tenant UUIDs. An empty allowlist
   admits no tenants. Tenants outside the list use native primary. Unset the
   allowlist only after the canary gates pass. With both variables absent the
   prerequisite implementation's stream primary behavior is preserved.
4. Run at least 10 Codex and 10 Claude canaries over 24 hours, including successful
   tool execution, a failed tool, interrupted/nonzero CLI exit, multiple polls,
   partial-line arrival, and a forced upload retry. Include at least 3 Pi runs.
   Confirm a tool call appears in the browser **before process exit**, its result
   refers to the call, and browser refresh does not duplicate events.
5. Fetch `/api/v1/runs/{runId}/diagnostics` and retain the safe response. Require
   `trace.projection.reconciliation.state=matched` for every streamed canary with
   a live cursor; `no_live_cursor` is not evidence of live completeness. Require
   zero mismatches, zero chunk conflicts beyond deliberately injected tests, no
   unexplained parse warnings, unknown-event rate below 1%, and stored native and
   primary artifacts. Verify the stream provider and CLI/harness/source version.
   For Pi require native primary, retained artifact, and visible calls/results.
6. Expand the allowlist gradually (10%, 50%, then all approved tenants), observing
   each stage for 24 hours under the same gates. Stop on a single reconciliation
   mismatch, missing native artifact, lost call/result, or cross-source conflict.

## Diagnostics and alerts

The declared source lives in `traceSources`; `trace.projection` identifies the
**actual** source, artifact checksum, parser revision, and reconciliation receipt.
`fallbackUsed` means an explicit native replay replaced a declared stream projection.
`liveCursor` shows file generation, committed byte offset, and pending byte count.
A missing receipt is not a complete trace. An unterminated final line is retained
in the artifact but is intentionally not projected. Warnings are visible events;
`counts` reports parse warnings and unknown events with their projected-event rate.

Structured logs have `component=trace`, tenant/run IDs, and a `metric`:
`chunk_parsed`, `chunk_retry`, `chunk_failure`, `chunk_collection_failure`,
`artifact_parsed`, `terminal_reconciliation`, `missing_native_artifact`, and
`replay_failure`, and `replay_outcome`. Aggregate warning/unknown counts divided by parsed event counts
per provider; alert at 1% unknown rate, any mismatch, or exhausted artifact retries.
Retry/failure counters measure attempts; logs emitted inside a transaction are
not commit evidence. Use persisted diagnostics to establish the final outcome.
No trace payloads, upload grants, or credentials are logged by these counters.
Collection has the existing bounded finalization retry policy; partial artifacts
remain a secondary diagnostic and do not replace the process exit status.

## Authorized backfill and resumption

Only an interactive tenant owner session with `runs:write` may POST
`/api/v1/runs/{runId}/trace/replay`:

```json
{"requestId":"<new UUID>","source":"primary"}
```

Page the tenant's `/api/v1/runs` API and checkpoint its pagination cursor, the run
ID and request UUID **before** each call. Process one run per request with one
in-flight request and at least 6 seconds between requests (10 attempts/minute per
tenant, including failures/retries). Do not use a global cross-tenant list.
Request IDs are scoped to the authenticated tenant. Keep a ledger of each returned
status/reason. Completed projection and operation receipts commit atomically.
Resume a failed/interrupted request using its original UUID; repeat successes
return the original result. Reusing that UUID for another run/source returns 409.
Retry 429 after one minute; retry 503/500 with bounded exponential backoff. Stop
and investigate 409 checksum/ownership conflicts; never bypass integrity checks.

`primary` uses the run's persisted source declaration; undeclared historical runs
use retained native sessions. This reprojects historical Codex `custom_tool_call`
and matching outputs with the corrected parser. Native sessions are never derived
from human logs. `already_projected` avoids unnecessary replacement at the same
checksum/source/parser revision. `skipped/run_active` leaves the run untouched.
`unrecoverable/missing_artifact` and `artifact_not_retained` explicitly mean no
recovery is possible from retained storage. Multiple candidate artifacts report
`ambiguous_artifacts`; unsupported providers/formats are skipped. A new request
UUID is necessary to reconsider a previously skipped/unrecoverable result after
conditions change. Parser/storage failures roll back projection and operation;
the original request UUID remains resumable. The last completed replay appears
in diagnostics; failed attempts appear in structured logs.

## Rollback

Set `TRACE_PRIMARY_MODE=native_session` for new launches and retain the canary
allowlist configuration for later review. Do not alter active run declarations or
reuse their generation IDs. Let active runs finalize and retain both snapshots.
For a terminal stream run, replay with a **new** request UUID and
`source=native_session`. Check the result is `projected` or `already_projected`,
`trace.projection.source_kind=native_session`, and `fallbackUsed=true`.
Both artifacts, live cursor, and chunk receipts remain intact. A late terminal
stream retry cannot undo this explicit rollback. Re-enable an individual run by
issuing a new replay request with `source=primary`; no new VM is needed.
If no native artifact is retained, rollback reports unrecoverable and preserves
the current projection. Never promise recovery or delete the stream to force it.

## Retention and incident debugging

Retain both exact primary and native snapshots for at least the rollout window
and 30 days after the final stage (or longer under the tenant's retention policy).
Do not enable an object lifecycle expiration shorter than this window. Deployment
and rollback do not remove objects. Job deletion intentionally deletes job artifacts
under the existing policy; deleted/expired bytes cannot be backfilled. Native
snapshots uploaded by this implementation use checksum-addressed keys; older
`native/session.jsonl` locators remain eligible. Object size and checksum must match
the tenant/run's stored receipt before replay. Never list the bucket to discover
another tenant's artifacts or change receipt metadata to bypass checks.

For an incident, freeze rollout; collect run diagnostics, deployment revision,
source/CLI/harness/parser versions, safe metric counts, and request IDs. Distinguish
process failure from collection failure. For a stale generation/offset conflict,
compare cursor generation and offset to the collector request; retry only the
same generation/offset/hash or perform the normal generation transition. Terminal
grants are bound to the observed generation and reject stale collectors. A
terminal reconciliation mismatch compares projected live events to their durable
prefix and checks that committed bytes do not exceed the snapshot size. Preserve
the immutable snapshots and receipts; use an authorized native replay if available.
If collection failed, let finalization retry before cleanup. After cleanup, absent
bytes are unrecoverable. Attach safe diagnostics and ledger outcomes to the incident.

## Evidence status

Repository tests exercise Codex/Claude live/terminal paths, retries, generation
conflicts, rollback, historical tool recovery, authorization, tenant isolation,
rate limiting, missing bytes, failed transaction resumption, and browser refresh.
Production canary evidence must be collected by the release operator after this
revision is deployed; repository tests must not be represented as that evidence.
