import { validateTraceSources, type TraceSource, type TraceSources } from "../trace-source";
import { AmpBackend, type AmpConnection } from "../amp-backend";
import { issueArtifactUploadGrant } from "../artifact-upload";
import { artifactKey } from "../artifacts";
import { ArtifactRepository } from "./artifact-repository";
import { safeDiagnosticText } from "../harness-diagnostics";
import { decrypt } from "../crypto";
import { ExeVmBackend } from "../exe-vm-backend";
import type { ArtifactCollector, ExecutionBackend, ExecutionTerminator, HarnessLogReader, JobFileCollector, JobResultReader, TraceChunkCollector } from "../execution";
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
import { JOB_RESULT_INSTRUCTIONS, parseJobResult } from "../job-result";
import { issueRunCredential, runProxyInstructions } from "../run-credentials";
import { ProxyLaunchBlockedError } from "../proxy-launch-policy";

export class RunScheduler {
  private runs: RunRepository;
  constructor(private database: Database, private env: Env) { this.runs = new RunRepository(database); }

  async process(): Promise<void> {
    await this.runs.consumeWakeHint();
    await new AutomationScheduler(this.database, this.env).process();
    for (const run of await this.runs.dueForPoll()) await this.poll(run).catch(error => this.fail(run, error, "poll"));
    for (let count = 0; count < 20; count++) {
      const run = await this.runs.claimNext(); if (!run) break;
      await this.launch(run).catch(error => error instanceof ProxyLaunchBlockedError
        ? this.runs.blockLaunch(run, `Credential proxy ${error.reason}; resolve the prerequisite and manually retry this run.`)
        : this.fail(run, error, "launch"));
    }
  }

  private connections(run: PersistedRun) { return new ConnectionRepository(this.database, run.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY); }

  private hasCapability<T extends object>(backend: ExecutionBackend, method: keyof T): backend is ExecutionBackend & T {
    return typeof (backend as unknown as Record<PropertyKey, unknown>)[method] === "function";
  }
  private async backend(run: PersistedRun): Promise<ExecutionBackend> {
    const id = String(run.executionConfig.connectionId ?? "");
    const kind = run.executionConfig.backendKind ?? (run.executionConfig.agentKind === "Amp" ? "amp" : "exe-vm");
    if (kind === "amp") { const connection = await this.connections(run).get<AmpConnection>(`amp:${id}`); if (!connection) throw new Error("Amp connection is unavailable"); return new AmpBackend(connection); }
    if (kind !== "exe-vm") throw new Error(`Unsupported execution backend: ${String(kind)}`);
    const connection = await this.connections(run).get<ExeRunConnection>(`exe:${id}`); if (!connection) throw new Error("exe.dev connection is unavailable");
    return new ExeVmBackend({ ...connection, tags: Array.isArray(run.executionConfig.tags) ? run.executionConfig.tags : [], image: typeof run.executionConfig.image === "string" ? run.executionConfig.image : undefined, model: String(run.executionConfig.model ?? ""), effort: String(run.executionConfig.effort ?? "") });
  }

  private async launch(run: PersistedRun) {
    if (run.executionConfig.executionType === "code") {
      if (typeof run.executionConfig.script !== "string" || !run.executionConfig.script.trim()) throw new Error("The code job has no saved script");
      const backend = await this.backend(run), context = run.executionConfig.inputContext;
      if (!context || typeof context !== "object" || Array.isArray(context)) throw new Error("The code job input context snapshot is missing");
      const runToken = await issueRunCredential(this.env, run.tenantId, run.id, run.executionConfig.runScopes);
      const reservation = backend.reserve?.(run.id) ?? null;
      if (reservation) await this.runs.recordLaunchHandle(run, reservation);
      const launched = await backend.launch({ runId: run.id, reservation: reservation ?? undefined, prompt: "", runProxy: { targetOrigin: this.env.APP_ORIGIN, credential: runToken }, code: { script: run.executionConfig.script, context } });
      await this.runs.markLaunched(run, launched.handle, launched.destinationUrl, launched.capabilities);
      if (launched.observation.state === "failed") await this.runs.recordObservation(run, launched.observation);
      return;
    }
    if (run.executionConfig.agentKind === "Amp") throw new Error("Amp execution is unavailable for new runs because it cannot deliver the required structured result file. Choose an exe.dev agent integration.");
    const backend = await this.backend(run), driver = agentDriver(run.executionConfig.agentKind as AgentKind), harness = driver.launch(run.id, { model: run.executionConfig.model, effort: run.executionConfig.effort, ...(driver.kind === "codex" ? { codexModel: { baseUrl: this.env.CODEX_MODEL_BASE_URL ?? "https://llm.int.exe.xyz/v1" } } : {}) });
    const sources = rolloutTraceSources(driverTraceSources(driver.kind, harness), run.tenantId, this.env);
    validateTraceSources(sources);
    const runToken = await issueRunCredential(this.env, run.tenantId, run.id, run.executionConfig.runScopes);
    const prompt = await decrypt(run.encryptedPrompt, this.env.CREDENTIAL_ENCRYPTION_KEY);
    const reservation = backend.reserve?.(run.id) ?? null;
    if (reservation) await this.runs.recordLaunchHandle(run, reservation);
    const launched = await backend.launch({ runId: run.id, reservation: reservation ?? undefined, prompt: `${prompt}${JOB_RESULT_INSTRUCTIONS}${runProxyInstructions(run.id)}`, runProxy: { targetOrigin: this.env.APP_ORIGIN, credential: runToken }, traceSources: sources, harness: { executable: harness.executable, args: harness.args, env: harness.env } });
    await this.runs.markLaunched(run, launched.handle, launched.destinationUrl, launched.capabilities, sources);
    if (launched.observation.state === "failed") await this.runs.recordObservation(run, launched.observation);
  }

  private async poll(run: PersistedRun) {
    if (!run.executionHandle && run.state === "stopping") return this.runs.schedulePoll(run, "stopping");
    const backend = await this.backend(run); if (!run.executionHandle) throw new Error("Execution handle is missing");
    const terminator = this.hasCapability<ExecutionTerminator>(backend, "terminate");
    if (run.state === "stopping" && !run.executionDiagnostics) await this.runs.recordStopAttempt(run);
    const observation = run.executionDiagnostics ?? (run.state === "stopping"
      ? terminator ? await backend.terminate(run.executionHandle) : await backend.stop(run.executionHandle)
      : await backend.inspect(run.executionHandle));
    if (["running", "blocked", "stopping"].includes(observation.state)) {
      if (this.hasCapability<TraceChunkCollector>(backend, "collectTraceChunk")) await this.collectTraceChunk(run, backend).catch(() => { traceMetric("chunk_collection_failure", run.tenantId, run.id); });
      return this.runs.schedulePoll(run, observation.state as "running" | "blocked" | "stopping");
    }
    // Persist the first terminal observation before any collection or deletion.
    // Retries use this snapshot even if the VM has subsequently disappeared.
    const diagnostics = await this.runs.recordObservation(run, { ...observation, detail: observation.detail ?? undefined });
    run.executionDiagnostics = diagnostics;
    let artifactState: "stored" | "partial" | "failed" = "stored";
    const errors: string[] = [];
    let finalState = diagnostics.state;
    let taskFailure: { source: "run" | "system"; code: string; reason: string } | undefined = run.failureCode && run.failureReason
      ? { source: diagnostics.failure?.source ?? "run", code: run.failureCode, reason: run.failureReason } : diagnostics.failure;
    if (taskFailure) await this.runs.recordFailureOutcome(run, taskFailure);
    if (!run.failureCode && run.resultProtocolVersion === 1 && diagnostics.state !== "failed" && diagnostics.state !== "stopped") {
      if (!this.hasCapability<JobResultReader>(backend, "readJobResult")) {
        finalState = "failed"; taskFailure = { source: "system", code: "result_collection_unavailable", reason: "Execution backend cannot collect the required structured job result" };
      } else {
        let raw: string | null;
        try { raw = await backend.readJobResult(run.executionHandle!); }
        catch (error) { throw error; } // Collection errors are transient and retried by finalization.
        if (raw === null) { finalState = "failed"; taskFailure = { source: "run", code: "result_missing", reason: "Required structured job result is missing" }; }
        else {
          let result;
          try { result = parseJobResult(raw); }
          catch (error) { finalState = "failed"; taskFailure = { source: "run", code: "result_invalid", reason: `Invalid structured job result: ${error instanceof Error ? error.message : "validation failed"}` }; }
          if (result) {
            await this.runs.recordJobResult(run, result);
            if (result.status === "failed") { finalState = "failed"; taskFailure ??= { source: "run", code: "task_reported_failure", reason: result.reason! }; }
          }
        }
      }
    }
    if (taskFailure) await this.runs.recordFailureOutcome(run, taskFailure);
    if (this.hasCapability<ArtifactCollector & HarnessLogReader & JobFileCollector>(backend, "collectArtifact") && this.hasCapability<HarnessLogReader>(backend, "readHarnessLog") && this.hasCapability<JobFileCollector>(backend, "listJobFiles") && this.hasCapability<JobFileCollector>(backend, "collectJobFile")) {
      const artifacts = new ArtifactRepository(this.database, run.tenantId);
      const stored = await artifacts.list(run.id);
      if (!stored.some(item => item.kind === "terminal_log" && item.state === "stored")) {
        try { await this.collectHarnessLog(run, backend, artifacts); }
        catch { errors.push("Harness log collection or storage failed"); }
      }
      const sources = run.executionConfig.executionType === "code" ? undefined : this.sources(run);
      if (run.executionConfig.executionType === "code") {
        // Code jobs have no agent session trace; preserve the shared result,
        // log, output directory, supervision, and cleanup lifecycle.
      } else {
      const sourceSet = sources!;
      if (sourceSet.primary.provider === "codex" && sourceSet.primary.kind !== "execution_stream") errors.push("Historical Codex native source is read-only; canonical execution stream was not declared");
      if (sourceSet.primary.kind === "execution_stream" && !stored.some(item => item.kind === "execution_stream" && item.state === "stored")) {
        try { const collected = await this.collectArtifact(run, backend, sourceSet.primary, true); if (!collected.ok) errors.push(`Canonical execution stream upload failed: ${sourceSet.primary.path}`); }
        catch { errors.push(`Canonical execution stream collection failed: ${sourceSet.primary.path}`); }
      }
      if (sourceSet.primary.provider !== "codex" && !stored.some(item => item.kind === "native_session" && item.state === "stored")) {
        try {
          const collected = await this.collectArtifact(run, backend);
          if (!collected.ok) { errors.push("Native session upload failed"); traceMetric("missing_native_artifact", run.tenantId, run.id, { attempt: run.finalizationAttempt ?? 0 }); }
        } catch { errors.push("Native session collection or storage failed"); traceMetric("missing_native_artifact", run.tenantId, run.id, { attempt: run.finalizationAttempt ?? 0 }); }
      }
      if (sourceSet.primary.kind === "execution_stream") {
        try { errors.push(...await this.finalizePrimary(run, sourceSet.primary)); }
        catch { errors.push("Retained primary trace projection failed"); }
      }
      }
      if (run.resultProtocolVersion === 1) {
        try {
          const current = await artifacts.list(run.id);
          const retained = new Set(current.filter(item => item.kind === "job_file" && item.state === "stored").map(item => item.source_path));
          for (const path of await backend.listJobFiles(run.executionHandle!)) {
            if (retained.has(path)) continue;
            const token = await issueArtifactUploadGrant({ tenantId: run.tenantId, runId: run.id, path, artifactType: "job_file", contentType: "application/octet-stream", provider: run.executionConfig.executionType === "code" ? "code" : run.executionConfig.agentKind, format: "file", expiresAt: Date.now() + 10 * 60_000 }, this.env.SESSION_SIGNING_SECRET);
            const uploaded = await backend.collectJobFile(run.executionHandle!, { path, uploadUrl: `${this.env.APP_ORIGIN}/internal/run-artifacts/${encodeURIComponent(token)}` });
            if (!uploaded.ok) throw new Error(uploaded.detail ?? "Job file upload failed");
          }
        } catch { errors.push("Job output file collection or storage failed"); }
      }
    } else errors.push("Execution backend does not support complete final artifact collection");
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
    if (finalState === "failed" && diagnostics.state === "succeeded" && !taskFailure) taskFailure = { source: "run", code: "task_reported_failure", reason: "The run reported an error" };
    await this.runs.terminal(run, finalState, artifactState, errors.filter(Boolean).join("; ") || undefined, true, taskFailure);
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

  private async collectHarnessLog(run: PersistedRun, backend: HarnessLogReader, artifacts: ArtifactRepository) {
    if (!this.env.RUN_ARTIFACTS || !run.executionHandle) throw new Error("Harness artifact storage is unavailable");
    const text = await backend.readHarnessLog(run.executionHandle);
    const bytes = new TextEncoder().encode(text);
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
    const key = artifactKey(run.tenantId, run.id, "harness/stderr.txt");
    await this.env.RUN_ARTIFACTS.put(key, bytes, { httpMetadata: { contentType: "text/plain; charset=utf-8" }, sha256 });
    await artifacts.record({ runId: run.id, kind: "terminal_log", objectKey: key, provider: run.executionConfig.executionType === "code" ? "code" : String(run.executionConfig.agentKind), format: "text", byteSize: bytes.length, sha256 });
  }

  private sources(run: PersistedRun): TraceSources {
    if (run.traceSources) return run.traceSources;
    // Undeclared Codex runs must never discover or create a native artifact.
    if (run.executionConfig.agentKind === "codex") return driverTraceSources("codex", agentDriver("codex").launch(run.id, {}));
    // Runs launched before a source declaration existed must keep their native
    // trace even when the current driver now produces an execution stream.
    return { primary: this.nativeSource(run) };
  }

  private nativeSource(run: PersistedRun): TraceSource {
    const kind = run.executionConfig.agentKind as AgentKind;
    const { traceSources: _sources, ...legacy } = agentDriver(kind).launch(run.id, {});
    return driverTraceSources(kind, legacy).primary;
  }

  private async collectArtifact(run: PersistedRun, backend: ArtifactCollector, source?: TraceSource, primary?: boolean) {
    if (!run.executionHandle) throw new Error("Execution handle is missing");
    const sources = this.sources(run);
    source ??= sources.nativeSession ?? sources.primary;
    primary ??= sources.primary.kind === "native_session";
    const traceGeneration = primary ? (await new LiveTraceRepository(this.database, run.tenantId).cursor(run.id)).generation : undefined;
    const token = await issueArtifactUploadGrant({ traceGeneration, tenantId: run.tenantId, runId: run.id, path: source.kind === "execution_stream" ? "trace/stream.jsonl" : "native/session.jsonl", contentType: source.mediaType, provider: source.provider, format: "jsonl", sourceKind: source.kind, sourcePath: source.path, formatVersion: source.formatVersion, cliVersion: source.cliVersion, harnessVersion: source.harnessVersion, primary, expiresAt: Date.now() + 10 * 60_000 }, this.env.SESSION_SIGNING_SECRET);
    return backend.collectArtifact(run.executionHandle, { source, contentType: source.mediaType, uploadUrl: `${this.env.APP_ORIGIN}/internal/run-artifacts/${encodeURIComponent(token)}` });
  }

  private async collectTraceChunk(run: PersistedRun, backend: ExecutionBackend & TraceChunkCollector) {
    if (!run.executionHandle) throw new Error("Execution handle is missing");
    const source = this.sources(run).primary;
    const cursor = await new LiveTraceRepository(this.database, run.tenantId).cursor(run.id);
    const token = await issueArtifactUploadGrant({ tenantId: run.tenantId, runId: run.id, path: "trace/live.jsonl", contentType: source.mediaType, provider: source.provider, format: "jsonl", sourceKind: source.kind, sourcePath: source.path, purpose: "trace_chunk", expiresAt: Date.now() + 60_000 }, this.env.SESSION_SIGNING_SECRET);
    return backend.collectTraceChunk(run.executionHandle, { source, generation: cursor.generation, offset: cursor.offset, previousHash: cursor.rollingHash, uploadUrl: `${this.env.APP_ORIGIN}/internal/run-trace-chunks/${encodeURIComponent(token)}` });
  }

  private async fail(run: PersistedRun, error: unknown, phase: "poll" | "launch" = "launch") {
    // Infrastructure errors while finalizing must not change the execution result.
    if (run.executionDiagnostics) {
      await this.runs.retryFinalization(run, "partial", "Run finalization temporarily failed");
      return;
    }
    // An unconfirmed inspection transport error must retry under the normal
    // polling lifecycle; it is not evidence that the guest task or system ended.
    if (phase === "poll" && run.executionHandle) {
      await this.runs.schedulePoll(run, run.state === "stopping" ? "stopping" : "running");
      return;
    }
    const reason = safeDiagnosticText(error instanceof Error ? error.message : "Run processing failed");
    await this.runs.recordObservation(run, { state: "failed", detail: reason, failure: { source: "system", code: "execution_unavailable", reason } });
    if (run.executionHandle) {
      if (run.state === "starting" || run.state === "stopping") await this.runs.markLaunched(run, run.executionHandle, `https://${run.executionHandle.id}.exe.xyz/`, run.capabilities ?? [], run.traceSources ?? undefined);
      await this.runs.schedulePoll(run, run.state === "stopping" ? "stopping" : "running");
      return;
    }
    await this.runs.terminal(run, "failed", "failed", undefined, false, { source: "system", code: "launch_failed", reason });
  }
}
