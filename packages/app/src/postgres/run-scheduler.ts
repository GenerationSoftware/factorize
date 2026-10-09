import { validateTraceSources, type TraceSource, type TraceSources } from "../trace-source";
import { AmpBackend, type AmpConnection } from "../amp-backend";
import { issueArtifactUploadGrant } from "../artifact-upload";
import { artifactKey } from "../artifacts";
import { ArtifactRepository } from "./artifact-repository";
import { safeDiagnosticText } from "../harness-diagnostics";
import { decrypt } from "../crypto";
import { ExeVmBackend } from "../exe-vm-backend";
import type { ExeRunConnection } from "../exe";
import type { Env } from "../types";
import { ConnectionRepository } from "./connection-repository";
import type { Database } from "./database";
import { RunRepository, type PersistedRun } from "./run-repository";
import { AutomationScheduler } from "./automation-scheduler";
import { agentDriver, driverTraceSources, type AgentKind } from "../agent-driver";
import { traceMetric } from "../trace-observability";
import { rolloutTraceSources } from "../trace-source";
import { TraceProjectionRepository, TRACE_PARSER_VERSION } from "./trace-projection-repository";
import { LiveTraceRepository } from "./live-trace-repository";

export class RunScheduler {
  private runs: RunRepository;
  constructor(private database: Database, private env: Env) { this.runs = new RunRepository(database); }

  async process(): Promise<void> {
    await this.runs.consumeWakeHint();
    await new AutomationScheduler(this.database, this.env).process();
    for (const run of await this.runs.dueForPoll()) await this.poll(run).catch(error => this.fail(run, error));
    for (let count = 0; count < 20; count++) { const run = await this.runs.claimNext(); if (!run) break; await this.launch(run).catch(error => this.fail(run, error)); }
  }

  private connections(run: PersistedRun) { return new ConnectionRepository(this.database, run.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY); }
  private async backend(run: PersistedRun) {
    const id = String(run.executionTarget.connectionId ?? "");
    if (run.executionTarget.agentKind === "Amp") { const connection = await this.connections(run).get<AmpConnection>(`amp:${id}`); if (!connection) throw new Error("Amp connection is unavailable"); return new AmpBackend(connection); }
    const connection = await this.connections(run).get<ExeRunConnection>(`exe:${id}`); if (!connection) throw new Error("exe.dev connection is unavailable");
    return new ExeVmBackend({ ...connection, model: String(run.executionTarget.model ?? ""), effort: String(run.executionTarget.effort ?? "") });
  }

  private async launch(run: PersistedRun) {
    const backend = await this.backend(run), driver = agentDriver(run.executionTarget.agentKind as AgentKind), harness = driver.launch(run.id, { model: run.executionTarget.model, effort: run.executionTarget.effort });
    const sources = rolloutTraceSources(driverTraceSources(driver.kind, harness), run.tenantId, this.env);
    validateTraceSources(sources);
    const launched = await backend.launch({ runId: run.id, prompt: await decrypt(run.encryptedPrompt, this.env.CREDENTIAL_ENCRYPTION_KEY), traceSources: sources, harness: { executable: harness.executable, args: harness.args, env: harness.env } });
    await this.runs.markLaunched(run, launched.handle, launched.destinationUrl, launched.capabilities, sources);
    if (launched.observation.state === "failed") await this.runs.recordObservation(run, launched.observation);
  }

  private async poll(run: PersistedRun) {
    const backend = await this.backend(run); if (!run.executionHandle) throw new Error("Execution handle is missing");
    const observation = run.executionDiagnostics ?? (run.state === "stopping" && backend instanceof ExeVmBackend ? await backend.terminate(run.executionHandle) : await backend.inspect(run.executionHandle));
    if (["running", "blocked", "stopping"].includes(observation.state)) {
      if (backend instanceof ExeVmBackend) await this.collectTraceChunk(run, backend).catch(() => { traceMetric("chunk_collection_failure", run.tenantId, run.id); });
      return this.runs.schedulePoll(run, observation.state as "running" | "blocked" | "stopping");
    }
    // Persist the first terminal observation before any collection or deletion.
    // Retries use this snapshot even if the VM has subsequently disappeared.
    const diagnostics = await this.runs.recordObservation(run, { ...observation, detail: observation.detail ?? undefined });
    run.executionDiagnostics = diagnostics;
    let artifactState: "stored" | "partial" | "failed" = "stored";
    const errors: string[] = [];
    if (backend instanceof ExeVmBackend) {
      const artifacts = new ArtifactRepository(this.database, run.tenantId);
      const stored = await artifacts.list(run.id);
      if (!stored.some(item => item.kind === "terminal_log" && item.state === "stored")) {
        try { await this.collectHarnessLog(run, backend, artifacts); }
        catch { errors.push("Harness log collection or storage failed"); }
      }
      const sources = this.sources(run);
      if (sources.primary.provider === "codex" && sources.primary.kind !== "execution_stream") errors.push("Historical Codex native source is read-only; canonical execution stream was not declared");
      if (sources.primary.kind === "execution_stream" && !stored.some(item => item.kind === "execution_stream" && item.state === "stored")) {
        try {
          const collected = await this.collectArtifact(run, backend, sources.primary, true);
          if (!collected.ok) errors.push(`Canonical execution stream upload failed: ${sources.primary.path}`);
        } catch { errors.push(`Canonical execution stream collection failed: ${sources.primary.path}`); }
      }
      if (sources.primary.provider !== "codex" && !stored.some(item => item.kind === "native_session" && item.state === "stored")) {
        try {
          const collected = await this.collectArtifact(run, backend);
          if (!collected.ok) { errors.push("Native session upload failed"); traceMetric("missing_native_artifact", run.tenantId, run.id, { attempt: run.finalizationAttempt ?? 0 }); }
        } catch { errors.push("Native session collection or storage failed"); traceMetric("missing_native_artifact", run.tenantId, run.id, { attempt: run.finalizationAttempt ?? 0 }); }
      }
      if (sources.primary.kind === "execution_stream") {
        try { errors.push(...await this.finalizePrimary(run, sources.primary)); }
        catch { errors.push("Retained primary trace projection failed"); }
      }
      // Retry collection, but do not keep a VM forever for an absent session/log.
      if (errors.length && (run.finalizationAttempt ?? 0) < 2) {
        await this.runs.retryFinalization(run, "partial", errors.join("; "));
        return;
      }
      if (errors.length) artifactState = "partial";
      try {
        const stopped = await backend.stop(run.executionHandle);
        if (stopped.state !== "stopped") throw new Error("VM cleanup failed");
      } catch {
        await this.runs.retryFinalization(run, artifactState, [...errors, "VM cleanup failed"].join("; "));
        return;
      }
    }
    await this.runs.terminal(run, diagnostics.state, artifactState, errors.join("; ") || undefined, true);
  }

  /** Retry projection from retained bytes, without relying on a surviving VM. */
  private async finalizePrimary(run: PersistedRun, source: TraceSource): Promise<string[]> {
    return this.database.transaction(async client => {
      await client.query("SELECT id FROM app.runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [run.tenantId, run.id]);
      const artifacts = await new ArtifactRepository(this.database, run.tenantId).list(run.id, client);
      const retained = artifacts.filter(item => item.kind === "execution_stream" && item.state === "stored");
      if (retained.length !== 1) return ["Canonical execution stream receipt missing or ambiguous"];
      const artifact = retained[0];
      if (artifact.source_path !== source.path || artifact.provider !== source.provider) return ["Canonical execution stream receipt source mismatch"];
      let projection = (await client.query("SELECT source_kind,artifact_sha256,parser_version,reconciliation FROM app.run_trace_projections WHERE tenant_id=$1 AND run_id=$2", [run.tenantId, run.id])).rows[0];
      if (projection?.source_kind !== source.kind || projection?.artifact_sha256 !== artifact.sha256 || projection?.parser_version !== TRACE_PARSER_VERSION) {
        const stored = await this.env.RUN_ARTIFACTS?.get(artifact.object_key);
        if (!stored) return ["Retained canonical execution stream object missing"];
        const hash = stored.checksums.sha256 ? [...new Uint8Array(stored.checksums.sha256)].map(byte => byte.toString(16).padStart(2, "0")).join("") : null;
        if (hash !== artifact.sha256 || stored.size !== Number(artifact.byte_size)) { await stored.body.cancel(); return ["Retained canonical execution stream checksum or size mismatch"]; }
        const reconciliation = await new TraceProjectionRepository(this.database, run.tenantId).project(client, run.id, { provider: source.provider, kind: source.kind, sha256: artifact.sha256, byte_size: artifact.byte_size }, stored.body, true);
        projection = { reconciliation };
      }
      const errors: string[] = [];
      if (!["matched", "no_live_cursor"].includes(projection?.reconciliation?.state)) errors.push("Canonical execution stream terminal reconciliation mismatch");
      if (source.provider === "codex") {
        const completed = (await client.query("SELECT count(*)::int completed FROM app.run_trace_events WHERE tenant_id=$1 AND run_id=$2 AND display_data->>'eventType'='turn.completed'", [run.tenantId, run.id])).rows[0]?.completed ?? 0;
        if (!completed) errors.push("Canonical Codex execution stream is incomplete: missing turn.completed");
      }
      return errors;
    });
  }

  private async collectHarnessLog(run: PersistedRun, backend: ExeVmBackend, artifacts: ArtifactRepository) {
    if (!this.env.RUN_ARTIFACTS || !run.executionHandle) throw new Error("Harness artifact storage is unavailable");
    const text = await backend.readHarnessLog(run.executionHandle);
    const bytes = new TextEncoder().encode(text);
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
    const key = artifactKey(run.tenantId, run.id, "harness/stderr.txt");
    await this.env.RUN_ARTIFACTS.put(key, bytes, { httpMetadata: { contentType: "text/plain; charset=utf-8" }, sha256 });
    await artifacts.record({ runId: run.id, kind: "terminal_log", objectKey: key, provider: String(run.executionTarget.agentKind), format: "text", byteSize: bytes.length, sha256 });
  }

  private sources(run: PersistedRun): TraceSources {
    if (run.traceSources) return run.traceSources;
    // Undeclared Codex runs must never discover or create a native artifact.
    if (run.executionTarget.agentKind === "codex") return driverTraceSources("codex", agentDriver("codex").launch(run.id, {}));
    // Runs launched before a source declaration existed must keep their native
    // trace even when the current driver now produces an execution stream.
    return { primary: this.nativeSource(run) };
  }

  private nativeSource(run: PersistedRun): TraceSource {
    const kind = run.executionTarget.agentKind as AgentKind;
    const { traceSources: _sources, ...legacy } = agentDriver(kind).launch(run.id, {});
    return driverTraceSources(kind, legacy).primary;
  }

  private async collectArtifact(run: PersistedRun, backend: ExeVmBackend, source?: TraceSource, primary?: boolean) {
    if (!run.executionHandle) throw new Error("Execution handle is missing");
    const sources = this.sources(run);
    source ??= sources.nativeSession ?? sources.primary;
    primary ??= sources.primary.kind === "native_session";
    const traceGeneration = primary ? (await new LiveTraceRepository(this.database, run.tenantId).cursor(run.id)).generation : undefined;
    const token = await issueArtifactUploadGrant({ traceGeneration, tenantId: run.tenantId, runId: run.id, path: source.kind === "execution_stream" ? "trace/stream.jsonl" : "native/session.jsonl", contentType: source.mediaType, provider: source.provider, format: "jsonl", sourceKind: source.kind, sourcePath: source.path, formatVersion: source.formatVersion, cliVersion: source.cliVersion, harnessVersion: source.harnessVersion, primary, expiresAt: Date.now() + 10 * 60_000 }, this.env.SESSION_SIGNING_SECRET);
    return backend.collectArtifact(run.executionHandle, { source, contentType: source.mediaType, uploadUrl: `${this.env.APP_ORIGIN}/internal/run-artifacts/${encodeURIComponent(token)}` });
  }

  private async collectTraceChunk(run: PersistedRun, backend: ExeVmBackend) {
    if (!run.executionHandle) throw new Error("Execution handle is missing");
    const source = this.sources(run).primary;
    const cursor = await new LiveTraceRepository(this.database, run.tenantId).cursor(run.id);
    const token = await issueArtifactUploadGrant({ tenantId: run.tenantId, runId: run.id, path: "trace/live.jsonl", contentType: source.mediaType, provider: source.provider, format: "jsonl", sourceKind: source.kind, sourcePath: source.path, purpose: "trace_chunk", expiresAt: Date.now() + 60_000 }, this.env.SESSION_SIGNING_SECRET);
    return backend.collectTraceChunk(run.executionHandle, { source, generation: cursor.generation, offset: cursor.offset, previousHash: cursor.rollingHash, uploadUrl: `${this.env.APP_ORIGIN}/internal/run-trace-chunks/${encodeURIComponent(token)}` });
  }

  private async fail(run: PersistedRun, error: unknown) {
    // Infrastructure errors while finalizing must not change the execution result.
    if (run.executionDiagnostics) {
      await this.runs.retryFinalization(run, "partial", "Run finalization temporarily failed");
      return;
    }
    await this.runs.recordObservation(run, { state: "failed", detail: safeDiagnosticText(error instanceof Error ? error.message : "Run processing failed") });
    await this.runs.terminal(run, "failed", "failed");
  }
}
