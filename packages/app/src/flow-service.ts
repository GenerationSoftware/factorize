import type { Env, OAuthProps } from "./types";
import type { JobInput, ManualInvocationInput } from "./flow-schemas";
import { nextOccurrence, validateScheduleConfig } from "./schedule";
import { databaseFor } from "./postgres/database";
import { IdentityRepository } from "./postgres/identity-repository";
import { AccessTokenRepository } from "./postgres/access-token-repository";
import { PostgresJobRepository } from "./postgres/job-repository";
import { ConnectionRepository } from "./postgres/connection-repository";
import { decrypt, encrypt } from "./crypto";
import { InvocationService, type Job, type Trigger } from "./job-domain";
import { RunQueryRepository } from "./postgres/run-query-repository";
import { TraceRepository } from "./postgres/trace-repository";
import { GitHubRepository } from "./postgres/github-repository";
import { IntegrationService } from "./postgres/integration-service";
import { OperationsRepository } from "./postgres/operations-repository";
import { installedTriggerAvailability } from "./trigger-availability";
import { invokeCustomHandler } from "./custom-handler";
import { validateWebhookHandler } from "./webhook-trigger";

export class ServiceError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

type Scope = "flows:read" | "flows:write" | "runs:read" | "runs:write";

export class ApiService {
  constructor(private env: Env, private auth: OAuthProps) {}

  private jobs() { return new PostgresJobRepository(databaseFor(this.env), this.auth.tenantId, value => encrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY), value => decrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY)); }
  private connections() { return new ConnectionRepository(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY); }

  private async executionTarget(id: string) {
    if (id.startsWith("amp:")) {
      const connectionId = id.slice(4), value = await this.connections().get<{ project: string }>(`amp:${connectionId}`);
      if (!value) throw new ServiceError(400, "invalid_request", "Execution target not found");
      return { connectionId, workspace: value.project, cwd: "", agentKind: "Amp" };
    }
    const value = await this.connections().get<{ agentKind: string }>(`exe:${id}`);
    if (!value) throw new ServiceError(400, "invalid_request", "Execution target not found");
    return { connectionId: id, workspace: "ephemeral", cwd: "/home/exedev/workspace", agentKind: value.agentKind };
  }

  private normalizedTriggers(input: JobInput["triggers"], existing: Trigger[] = []): Trigger[] {
    const source = input.some(trigger => trigger.kind === "manual") ? input : [{ kind: "manual" as const, enabled: true, config: {} }, ...input];
    const prior = new Map(existing.map(trigger => [trigger.id, trigger])), used = new Set(existing.map(trigger => trigger.slug));
    let next = 1, timestamp = new Date().toISOString();
    return source.map(trigger => {
      const old = trigger.id ? prior.get(trigger.id) : undefined;
      while (used.has(`trigger-${next}`)) next++;
      const slug = old?.slug ?? trigger.slug ?? `trigger-${next++}`; used.add(slug);
      return { id: old?.id ?? trigger.id ?? crypto.randomUUID(), jobId: old?.jobId ?? "", kind: trigger.kind, slug, enabled: trigger.enabled !== false, config: trigger.config, createdAt: old?.createdAt ?? timestamp, updatedAt: timestamp };
    });
  }

  private presentJob(job: Job) {
    return { ...job, runNameTemplate: job.runNameTemplate ?? "", executionTargetId: `${job.executionTarget.agentKind === "Amp" ? "amp:" : ""}${job.executionTarget.connectionId}`, agentKind: job.executionTarget.agentKind, runningCount: 0, currentRuns: 0, maxConcurrency: job.concurrencyLimit, lastRunState: null };
  }

  private async authorize(scope: Scope): Promise<void> {
    if (!this.auth.scopes.includes(scope)) throw new ServiceError(403, "insufficient_scope", `The ${scope} scope is required.`);
    const database = databaseFor(this.env);
    const member = await new IdentityRepository(database, this.auth.tenantId).member(this.auth.userId);
    const tokenActive = !this.auth.accessTokenId || await new AccessTokenRepository(database, this.auth.tenantId).active(this.auth.accessTokenId);
    if (member?.role !== "owner" || member.sessionVersion !== this.auth.sessionVersion || !tokenActive) throw new ServiceError(401, "invalid_token", "The request is not authorized.");
  }

  private publicJob(value: any) {
    for (const trigger of value?.triggers ?? []) {
      const provider = trigger.kind === "webhook" ? trigger.config?.provider : undefined;
      if (provider === "cloudflareTail") trigger.config.destination = `${this.env.APP_ORIGIN}/webhooks/cloudflare/${encodeURIComponent(this.auth.tenantId)}/${encodeURIComponent(value.id)}`;
    }
    return value;
  }

  async listExeConnections() { await this.authorize("flows:read"); return (await new IntegrationService(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY).status()).exeConnections; }
  async listGitHubInstallations() { await this.authorize("flows:read"); return new GitHubRepository(databaseFor(this.env), this.auth.tenantId).installations(); }
  async listTailIntegrations() { await this.authorize("flows:read"); return new IntegrationService(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY).tails(); }
  async listRuns(query: URLSearchParams) { await this.authorize("runs:read"); return new RunQueryRepository(databaseFor(this.env), this.auth.tenantId).list(query); }
  async search(query: string) { await this.authorize("runs:read"); return new OperationsRepository(databaseFor(this.env), this.auth.tenantId).search(query); }
  async getRun(runId: string) { await this.authorize("runs:read"); const repository = new RunQueryRepository(databaseFor(this.env), this.auth.tenantId), run = await repository.get(runId); if (!run) throw new ServiceError(404, "not_found", "Run not found"); const prompt = await decrypt(run.encrypted_prompt, this.env.CREDENTIAL_ENCRYPTION_KEY); delete run.encrypted_prompt; run.prompt = prompt; run.capabilities = run.execution_capabilities; run.backend_kind = run.execution_backend_kind; run.invocation = { id: run.invocation_id, source: run.invocation_source, claim_key: run.invocation_claim_key, trigger_id: run.invocation_trigger_id, context: run.context, occurrence: run.occurrence, created_at: run.invocation_created_at }; run.activity = await repository.activity(runId); return run; }
  async getRunTrace(runId: string, after: number, limit: number) { await this.authorize("runs:read"); return new TraceRepository(databaseFor(this.env), this.auth.tenantId).page(runId, after, limit); }
  async getRunDiagnostics(runId: string) { const run: any = await this.getRun(runId); return { runId: run.id, jobId: run.job_id, state: run.state, provider: run.provider, backendKind: run.execution_backend_kind, artifact: { state: run.artifact_state, error: run.artifact_error }, activity: run.activity, createdAt: run.created_at, updatedAt: run.updated_at }; }
  async stopRun(runId: string) { await this.authorize("runs:write"); const stopped = await new RunQueryRepository(databaseFor(this.env), this.auth.tenantId).stop(runId); if (!stopped) throw new ServiceError(409, "operation_failed", "Run is not active"); if (this.env.SCHEDULER) await this.env.SCHEDULER.get(this.env.SCHEDULER.idFromName("global")).fetch("https://scheduler/wake", { method: "POST" }); return stopped; }
  killRun(runId: string) { return this.stopRun(runId); }
  async listJobs() { await this.authorize("flows:read"); return Promise.all((await this.jobs().list()).map(job => this.presentJob(job))); }
  async getJob(jobId: string) { await this.authorize("flows:read"); const job = await this.jobs().getJob(jobId); if (!job) throw new ServiceError(404, "not_found", "Job not found"); return this.presentJob(job); }
  async listJobEvents(jobId: string, limit = 50) { await this.authorize("runs:read"); return new OperationsRepository(databaseFor(this.env), this.auth.tenantId).jobEvents(jobId, limit); }
  async listWebhookDeliveries(query: URLSearchParams) { await this.authorize("runs:read"); return new OperationsRepository(databaseFor(this.env), this.auth.tenantId).deliveries(query); }
  async getWebhookDelivery(deliveryId: string) { await this.authorize("runs:read"); const value = await new OperationsRepository(databaseFor(this.env), this.auth.tenantId).delivery(deliveryId); if (!value) throw new ServiceError(404,"not_found","Webhook delivery not found"); return value; }
  async testJobHandler(input: { handlerCode: string; payload: Record<string, unknown> }) { await this.authorize("flows:write"); const config: any = { provider: "linear", projectId: "handler-test", matchRules: [], handlerCode: input.handlerCode }; validateWebhookHandler(config); if (!this.env.CUSTOM_HANDLER_LOADER) throw new ServiceError(503,"operation_failed","Webhook handler platform is unavailable"); return invokeCustomHandler(this.env.CUSTOM_HANDLER_LOADER, config, input.payload); }
  async createJob(input: JobInput) {
    await this.authorize("flows:write"); const timestamp = new Date().toISOString(), id = crypto.randomUUID();
    const triggers = this.normalizedTriggers(input.triggers).map(trigger => ({ ...trigger, jobId: id }));
    const job: Job = { id, name: input.name, slug: input.slug, promptTemplate: input.promptTemplate, runNameTemplate: input.runNameTemplate ?? "", model: input.model ?? "", ...(input.effort ? { effort: input.effort } : {}), executionTarget: await this.executionTarget(input.executionTargetId), concurrencyLimit: input.concurrencyLimit, enabled: true, triggers, createdAt: timestamp, updatedAt: timestamp };
    try { return this.presentJob(await this.jobs().save(job)); } catch (error: any) { if (error?.code === "23505") throw new ServiceError(409, "conflict", "Job slug is already in use"); throw error; }
  }
  async updateJob(jobId: string, input: JobInput) {
    await this.authorize("flows:write"); const repository = this.jobs(), current = await repository.getJob(jobId); if (!current) throw new ServiceError(404, "not_found", "Job not found");
    const triggers = this.normalizedTriggers(input.triggers, current.triggers).map(trigger => ({ ...trigger, jobId }));
    return this.presentJob(await repository.save({ ...current, name: input.name, slug: input.slug, promptTemplate: input.promptTemplate, runNameTemplate: input.runNameTemplate ?? "", model: input.model ?? "", effort: input.effort, executionTarget: await this.executionTarget(input.executionTargetId), concurrencyLimit: input.concurrencyLimit, triggers, updatedAt: new Date().toISOString() }));
  }
  async deleteJob(jobId: string) { await this.authorize("flows:write"); if (!await this.jobs().delete(jobId)) throw new ServiceError(404, "not_found", "Job not found"); return { id: jobId, deleted: true }; }
  async setJobEnabled(jobId: string, enabled: boolean) { await this.authorize("flows:write"); const repository = this.jobs(), job = await repository.getJob(jobId); if (!job) throw new ServiceError(404, "not_found", "Job not found"); await repository.save({ ...job, enabled, updatedAt: new Date().toISOString() }); return { id: jobId, enabled }; }
  async invokeJob(jobId: string, input: ManualInvocationInput) {
    await this.authorize("runs:write"); const repository = this.jobs(), job = await repository.getJob(jobId); if (!job) throw new ServiceError(404, "not_found", "Job not found");
    const trigger = job.triggers.find(value => value.kind === "manual" && value.enabled); if (!trigger) throw new ServiceError(409, "operation_failed", "The manual trigger is disabled");
    const service = new InvocationService(repository, value => encrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY));
    const result = await service.invoke(jobId, { source: "manual", triggerId: trigger.id, claimKey: input.idempotencyKey ? `manual:${input.idempotencyKey}` : `manual:${crypto.randomUUID()}`, context: { [trigger.slug]: { prompt: input.prompt, data: input.data ?? {} } } });
    if (this.env.SCHEDULER) await this.env.SCHEDULER.get(this.env.SCHEDULER.idFromName("global")).fetch("https://scheduler/wake", { method: "POST" });
    return { invocationId: result.invocation.id, runId: result.run.id, state: result.run.state, duplicate: result.duplicate };
  }
  async listExecutionTargets() {
    await this.authorize("flows:read"); const connections = this.connections(), kinds = await connections.kinds(); const targets: any[] = [];
    for (const kind of kinds) if (kind.startsWith("exe:")) { const id = kind.slice(4), value = await connections.get<any>(kind); targets.push({ id, kind: "exe-vm", name: "Ephemeral exe.dev VMs", workspace: "ephemeral", cwd: "/home/exedev/workspace", agentKind: value.agentKind, models: value.models ?? [], modelsRefreshedAt: value.modelsRefreshedAt ?? null, efforts: value.agentKind === "codex" ? ["minimal", "low", "medium", "high", "xhigh"] : [], capabilities: ["recovery", "stop"] }); }
    else if (kind.startsWith("amp:")) { const id = kind.slice(4), value = await connections.get<any>(kind); targets.push({ id: `amp:${id}`, kind: "amp", name: `Amp · ${value.project}`, workspace: value.project, cwd: "Cloud orb", agentKind: "Amp", capabilities: ["stop"] }); }
    return targets;
  }
  async diagnoseExeIntegration(connectionId: string) { await this.authorize("flows:write"); const value = await new IntegrationService(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY).diagnoseExe(connectionId); if (!value) throw new ServiceError(404,"not_found","Integration not found"); return value; }
  async listJobTriggerAvailability() { await this.authorize("flows:read"); const connections=this.connections(), kinds=await connections.kinds(), states=(await new GitHubRepository(databaseFor(this.env),this.auth.tenantId).installations()).map((x:any)=>x.state); return installedTriggerAvailability(kinds.includes("linear"),kinds.includes("clickup"),states,kinds.filter(x=>x.startsWith("cloudflare-tail:")).length); }
  async previewSchedule(input: unknown) {
    await this.authorize("flows:read");
    try {
      const config = validateScheduleConfig(input);
      return { nextRunAt: nextOccurrence(config, new Date()).toISOString() };
    } catch (error) {
      throw new ServiceError(400, "invalid_request", error instanceof Error ? error.message : "Invalid schedule");
    }
  }
}
