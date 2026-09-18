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
import { agentDriver, type AgentKind } from "../agent-driver";
import { LiveTraceRepository } from "./live-trace-repository";

export class RunScheduler {
  private runs: RunRepository;
  constructor(private database: Database, private env: Env) { this.runs = new RunRepository(database); }

  async process(): Promise<void> {
    await this.runs.consumeWakeHint();
    await new AutomationScheduler(this.database, this.env).process();
    await this.runs.requeueExpiredStarts();
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
    const launched = await backend.launch({ runId: run.id, prompt: await decrypt(run.encryptedPrompt, this.env.CREDENTIAL_ENCRYPTION_KEY), harness: { executable: harness.executable, args: harness.args, env: harness.env } });
    await this.runs.markLaunched(run, launched.handle, launched.destinationUrl, launched.capabilities);
    if (launched.observation.state === "failed") await this.runs.recordObservation(run, launched.observation);
  }

  private async poll(run: PersistedRun) {
    const backend = await this.backend(run); if (!run.executionHandle) throw new Error("Execution handle is missing");
    const observation = run.executionDiagnostics ?? await backend.inspect(run.executionHandle);
    if (["running", "blocked", "stopping"].includes(observation.state)) {
      if (backend instanceof ExeVmBackend) await this.collectTraceChunk(run, backend).catch(() => undefined);
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
      if (!stored.some(item => item.kind === "native_session" && item.state === "stored")) {
        try {
          const collected = await this.collectArtifact(run, backend);
          if (!collected.ok) errors.push("Native session upload failed");
        } catch { errors.push("Native session collection or storage failed"); }
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

  private async collectHarnessLog(run: PersistedRun, backend: ExeVmBackend, artifacts: ArtifactRepository) {
    if (!this.env.RUN_ARTIFACTS || !run.executionHandle) throw new Error("Harness artifact storage is unavailable");
    const text = await backend.readHarnessLog(run.executionHandle);
    const bytes = new TextEncoder().encode(text);
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
    const key = artifactKey(run.tenantId, run.id, "harness/stderr.txt");
    await this.env.RUN_ARTIFACTS.put(key, bytes, { httpMetadata: { contentType: "text/plain; charset=utf-8" }, sha256 });
    await artifacts.record({ runId: run.id, kind: "terminal_log", objectKey: key, provider: String(run.executionTarget.agentKind), format: "text", byteSize: bytes.length, sha256 });
  }

  private async collectArtifact(run: PersistedRun, backend: ExeVmBackend) {
    if (!run.executionHandle) throw new Error("Execution handle is missing");
    const agentKind = run.executionTarget.agentKind as AgentKind, locator = agentDriver(agentKind).launch(run.id, {}).artifacts;
    const token = await issueArtifactUploadGrant({ tenantId: run.tenantId, runId: run.id, path: "native/session.jsonl", contentType: "application/x-ndjson", provider: agentKind, format: "jsonl", nativeSessionId: agentKind === "codex" ? undefined : run.id, expiresAt: Date.now() + 10 * 60_000 }, this.env.SESSION_SIGNING_SECRET);
    return backend.collectArtifact(run.executionHandle, { discoverCommand: locator.discoverCommand, contentType: "application/x-ndjson", uploadUrl: `${this.env.APP_ORIGIN}/internal/run-artifacts/${encodeURIComponent(token)}` });
  }

  private async collectTraceChunk(run: PersistedRun, backend: ExeVmBackend) {
    if (!run.executionHandle) throw new Error("Execution handle is missing");
    const agentKind = run.executionTarget.agentKind as AgentKind, locator = agentDriver(agentKind).launch(run.id, {}).artifacts;
    const cursor = await new LiveTraceRepository(this.database, run.tenantId).cursor(run.id);
    const token = await issueArtifactUploadGrant({ tenantId: run.tenantId, runId: run.id, path: "native/live.jsonl", contentType: "application/octet-stream", provider: agentKind, format: "jsonl", nativeSessionId: agentKind === "codex" ? undefined : run.id, purpose: "trace_chunk", expiresAt: Date.now() + 60_000 }, this.env.SESSION_SIGNING_SECRET);
    return backend.collectTraceChunk(run.executionHandle, { discoverCommand: locator.discoverCommand, generation: cursor.generation, offset: cursor.offset, previousHash: cursor.rollingHash, uploadUrl: `${this.env.APP_ORIGIN}/internal/run-trace-chunks/${encodeURIComponent(token)}` });
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
