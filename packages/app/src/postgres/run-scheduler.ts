import { AmpBackend, type AmpConnection } from "../amp-backend";
import { issueArtifactUploadGrant } from "../artifact-upload";
import { decrypt } from "../crypto";
import { ExeVmBackend } from "../exe-vm-backend";
import type { ExeRunConnection } from "../exe";
import type { Env } from "../types";
import { ConnectionRepository } from "./connection-repository";
import type { Database } from "./database";
import { RunRepository, type PersistedRun } from "./run-repository";
import { AutomationScheduler } from "./automation-scheduler";
import { agentDriver, type AgentKind } from "../agent-driver";

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
    if (launched.observation.state === "failed") throw new Error(launched.observation.detail ?? "Agent launch failed");
    await this.runs.markLaunched(run, launched.handle, launched.destinationUrl, launched.capabilities);
  }

  private async poll(run: PersistedRun) {
    const backend = await this.backend(run); if (!run.executionHandle) throw new Error("Execution handle is missing");
    const observation = await backend.inspect(run.executionHandle);
    if (["running", "blocked", "stopping"].includes(observation.state)) return this.runs.schedulePoll(run, observation.state as "running" | "blocked" | "stopping");
    let artifactState: "stored" | "partial" | "failed" = "stored", artifactError: string | undefined;
    if (backend instanceof ExeVmBackend) {
      const agentKind = run.executionTarget.agentKind as AgentKind, locator = agentDriver(agentKind).launch(run.id, {}).artifacts;
      const token = await issueArtifactUploadGrant({ tenantId: run.tenantId, runId: run.id, path: "native/session.jsonl", contentType: "application/x-ndjson", provider: agentKind, format: "jsonl", nativeSessionId: agentKind === "codex" ? undefined : run.id, expiresAt: Date.now() + 10 * 60_000 }, this.env.SESSION_SIGNING_SECRET);
      const collected = await backend.collectArtifact!(run.executionHandle, { discoverCommand: locator.discoverCommand, contentType: "application/x-ndjson", uploadUrl: `${this.env.APP_ORIGIN}/internal/run-artifacts/${encodeURIComponent(token)}` });
      if (!collected.ok) { artifactState = "failed"; artifactError = collected.detail; }
      const stopped = await backend.stop(run.executionHandle); if (stopped.state !== "stopped") { artifactState = artifactState === "stored" ? "partial" : artifactState; artifactError = [artifactError, stopped.detail].filter(Boolean).join("; "); }
    }
    const state = observation.state === "succeeded" ? "succeeded" : observation.state === "stopped" ? "stopped" : "failed";
    await this.runs.terminal(run, state, artifactState, artifactError);
  }

  private async fail(run: PersistedRun, error: unknown) { await this.runs.terminal(run, "failed", "failed", error instanceof Error ? error.message : "Run processing failed"); }
}
