import { searchResponse } from "./search-contracts";
import { integrationStatus, exeConnection, accessToken, createdAccessToken, authorizedClient } from "./settings-contracts";
import { namedOption, providerOptions, githubRepository, executionTargetResponse, githubInstallation, tailIntegration } from "./editor-contracts";
import { z } from "zod";
import { runPageResponse, fullRunResponse } from "./run-read-contracts";
import { triggerContextCatalog } from "./trigger-context";
import type { Env, OAuthProps } from "./types";
import type { JobInput, ManualInvocationInput } from "./flow-schemas";
import { nextOccurrence, validateScheduleConfig } from "./schedule";
import { databaseFor } from "./postgres/database";
import { IdentityRepository } from "./postgres/identity-repository";
import { AccessTokenRepository } from "./postgres/access-token-repository";
import { JobSummaryRepository } from "./postgres/job-summary-repository";
import { jobResponse } from "./job-contracts";
import type { JobPageQuery } from "./job-contracts";
import { PostgresJobRepository, StaleJobEdit } from "./postgres/job-repository";
import { ConnectionRepository } from "./postgres/connection-repository";
import { decrypt, encrypt } from "./crypto";
import { InvocationService, type Job, type Trigger } from "./job-domain";
import { RunQueryRepository } from "./postgres/run-query-repository";
import { TraceRepository } from "./postgres/trace-repository";
import { GitHubRepository } from "./postgres/github-repository";
import { IntegrationService } from "./postgres/integration-service";
import { OperationsRepository } from "./postgres/operations-repository";
import { installedTriggerAvailability } from "./trigger-availability";
import { evaluateWebhookConditions } from "./webhook-conditions";
import { jobConditionsTestSchema } from "./flow-schemas";
import { ProviderCatalog } from "./postgres/provider-catalog";
import { ArtifactRepository } from "./postgres/artifact-repository";
import { ACCESS_SCOPES, accessTokenDigest, issueAccessToken } from "./access-tokens";

import { TraceProjectionRepository } from "./postgres/trace-projection-repository";
import { replayTrace, traceReplaySchema, traceReplayRunIdSchema, TraceReplayError } from "./trace-replay";

export class ServiceError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/** Response validation failures are server defects, never malformed client input. */
export function publicValue<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    console.error(JSON.stringify({ event: "public_contract_failure", issues: result.error.issues.map(issue => ({ path: issue.path, code: issue.code })) }));
    throw new ServiceError(500, "internal_error", "Factorize returned an invalid resource.");
  }
  return result.data;
}

type Scope = "flows:read" | "flows:write" | "runs:read" | "runs:write";

export class ApiService {
  authorizationDuration = 0;
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
      // A trigger's kind is part of its identity. Changing kind is a removal
      // plus an insertion, never an in-place mutation of historical identity.
      const candidate = trigger.id ? prior.get(trigger.id) : undefined;
      const old = candidate?.kind === trigger.kind ? candidate : undefined;
      while (used.has(`trigger-${next}`)) next++;
      const slug = old?.slug ?? trigger.slug ?? `trigger-${next++}`; used.add(slug);
      return { id: old?.id ?? crypto.randomUUID(), jobId: old?.jobId ?? "", kind: trigger.kind, slug, enabled: trigger.enabled !== false, config: trigger.config, createdAt: old?.createdAt ?? timestamp, updatedAt: timestamp };
    });
  }

  private async jobStatistics(ids: string[]) {
    if (!ids.length) return new Map<string, { running_count: string; last_run_state: string | null }>();
    const result = await databaseFor(this.env).pool.query<{ job_id: string; running_count: string; last_run_state: string | null }>(`
      WITH selected_runs AS (
        SELECT job_id,state,created_at,id FROM app.job_runs WHERE tenant_id=$1 AND job_id=ANY($2::uuid[])
      ), counts AS (
        SELECT job_id,count(*) FILTER (WHERE state IN ('reserved','starting','running','blocked','stopping'))::text running_count
        FROM selected_runs GROUP BY job_id
      ), latest AS (
        SELECT DISTINCT ON (job_id) job_id,state FROM selected_runs ORDER BY job_id,created_at DESC,id DESC
      )
      SELECT c.job_id,c.running_count,l.state last_run_state FROM counts c JOIN latest l USING (job_id)`, [this.auth.tenantId, ids]);
    return new Map(result.rows.map(row => [row.job_id, row]));
  }

  private async presentJob(job: Job, loadedStats?: { running_count: string; last_run_state: string | null }) {
    const stats = loadedStats ?? (await this.jobStatistics([job.id])).get(job.id);
    const runningCount = Number(stats?.running_count ?? 0);
    return publicValue(jobResponse, { ...job, triggers: job.triggers.map(trigger => ({ ...trigger, config: trigger.kind === "webhook" ? { ...trigger.config, ...(trigger.config.signingSecret || trigger.config.secret ? { secretConfigured: true } : {}), ...(trigger.config.provider === "cloudflareTail" ? { destination: `${this.env.APP_ORIGIN}/webhooks/cloudflare/${encodeURIComponent(this.auth.tenantId)}/${encodeURIComponent(job.id)}` } : {}) } : trigger.config })), runNameTemplate: job.runNameTemplate ?? "", executionTargetId: `${job.executionTarget.agentKind === "Amp" ? "amp:" : ""}${job.executionTarget.connectionId}`, agentKind: job.executionTarget.agentKind, runningCount, currentRuns: runningCount, maxConcurrency: job.concurrencyLimit, lastRunState: stats?.last_run_state ?? null });
  }

  private async authorize(scope: Scope): Promise<void> {
    if (!this.auth.scopes.includes(scope)) throw new ServiceError(403, "insufficient_scope", `The ${scope} scope is required.`);
    const started = performance.now();
    try {
      const database = databaseFor(this.env);
      const member = await new IdentityRepository(database, this.auth.tenantId).member(this.auth.userId);
      const tokenActive = !this.auth.accessTokenId || await new AccessTokenRepository(database, this.auth.tenantId).active(this.auth.accessTokenId);
      if (member?.role !== "owner" || member.sessionVersion !== this.auth.sessionVersion || !tokenActive) throw new ServiceError(401, "invalid_token", "The request is not authorized.");
    } finally { this.authorizationDuration += performance.now() - started; }
  }
  private async authorizeOwnerSession(scope: Scope): Promise<void> { await this.authorize(scope); if (this.auth.authMethod !== "session") throw new ServiceError(403, "session_required", "An interactive owner session is required."); }


  async listExeConnections() { await this.authorize("flows:read"); return publicValue(z.array(exeConnection), (await new IntegrationService(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY).status()).exeConnections); }
  async listGitHubInstallations() { await this.authorize("flows:read"); return publicValue(z.array(githubInstallation), JSON.parse(JSON.stringify(await new GitHubRepository(databaseFor(this.env), this.auth.tenantId).installations()))); }
  async listTailIntegrations() { await this.authorize("flows:read"); return publicValue(z.array(tailIntegration), await new IntegrationService(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY).tails()); }
  async listRuns(query: URLSearchParams) { await this.authorize("runs:read"); return publicValue(runPageResponse, JSON.parse(JSON.stringify(await new RunQueryRepository(databaseFor(this.env), this.auth.tenantId).list(query)))); }
  async search(query: string) { await this.authorize("runs:read"); return publicValue(searchResponse, await new OperationsRepository(databaseFor(this.env), this.auth.tenantId).search(query)); }
  async triggerContextMetadata() { await this.authorize("flows:read"); return triggerContextCatalog; }
  async getRunStatus(runId: string) { await this.authorize("runs:read"); const status = await new RunQueryRepository(databaseFor(this.env), this.auth.tenantId).status(runId); if (!status) throw new ServiceError(404, "not_found", "Run not found"); return status; }
  async getRevisionTrace(runId: string, after: number, limit: number, revision?: string) { await this.authorize("runs:read"); const page = await new TraceRepository(databaseFor(this.env), this.auth.tenantId).revisionPage(runId, after, limit, revision); if (!page) throw new ServiceError(404, "not_found", "Run not found"); return page; }
  async getRun(runId: string) {
    await this.authorize("runs:read");
    const repository = new RunQueryRepository(databaseFor(this.env), this.auth.tenantId);
    const run = await repository.get(runId);
    if (!run) throw new ServiceError(404, "not_found", "Run not found");
    const prompt = await decrypt(run.encrypted_prompt, this.env.CREDENTIAL_ENCRYPTION_KEY);
    delete run.encrypted_prompt; run.prompt = prompt; run.capabilities = run.execution_capabilities; run.backend_kind = run.execution_backend_kind; run.invocation = { id: run.invocation_id, source: run.invocation_source, claim_key: run.invocation_claim_key, trigger_id: run.invocation_trigger_id, context: run.context, occurrence: run.occurrence, created_at: run.invocation_created_at };
    const [activity, projection, cursor, artifacts] = await Promise.all([
      repository.activity(runId),
      databaseFor(this.env).pool.query("SELECT source_kind,artifact_sha256,parser_version,updated_at FROM app.run_trace_projections WHERE tenant_id=$1 AND run_id=$2", [this.auth.tenantId, runId]),
      databaseFor(this.env).pool.query("SELECT generation FROM app.run_trace_cursors WHERE tenant_id=$1 AND run_id=$2", [this.auth.tenantId, runId]),
      new ArtifactRepository(databaseFor(this.env), this.auth.tenantId).list(runId),
    ]);
    run.activity = activity; run.execution_diagnostics ??= null; run.trace_sources ??= null;
    run.trace_projection = projection.rows[0] ?? null; run.trace_generation = cursor.rows[0]?.generation ?? null;
    run.harness_log = artifacts.find(item => item.kind === "terminal_log") ?? null;
    // Enumerate public fields rather than publishing future database columns.
    return publicValue(fullRunResponse, JSON.parse(JSON.stringify({ id: run.id, tenant_id: run.tenant_id, job_id: run.job_id, invocation_id: run.invocation_id,
      execution_handle: run.execution_handle ? { backendKind: run.execution_handle.backendKind, id: run.execution_handle.id } : null,
      provider: run.provider, issue_id: run.issue_id, issue_url: run.issue_url, issue_title: run.issue_title,
      run_name: run.run_name, agent_name: run.agent_name, workspace_name: run.workspace_name, agent_kind: run.agent_kind,
      state: run.state, execution_backend_kind: run.execution_backend_kind, backend_kind: run.backend_kind,
      execution_capabilities: run.execution_capabilities, capabilities: run.capabilities, destination_url: run.destination_url,
      artifact_state: run.artifact_state, artifact_error: run.artifact_error,
      claim_released: run.claim_released, vm_cleanup_attempt: run.vm_cleanup_attempt, cleanup_next_at: run.cleanup_next_at, vm_cleanup_complete: run.vm_cleanup_complete,
      created_at: run.created_at, updated_at: run.updated_at, started_at: run.started_at,
      job_name: run.job_name, prompt: run.prompt, context: run.context, occurrence: run.occurrence, invocation: run.invocation,
      invocation_source: run.invocation_source, invocation_claim_key: run.invocation_claim_key, invocation_trigger_id: run.invocation_trigger_id, invocation_created_at: run.invocation_created_at,
      activity: run.activity, execution_diagnostics: run.execution_diagnostics, trace_sources: run.trace_sources,
      trace_projection: run.trace_projection, trace_generation: run.trace_generation, harness_log: run.harness_log })));
  }
  async getRunTrace(runId: string, after: number, limit: number) { await this.authorize("runs:read"); return new TraceRepository(databaseFor(this.env), this.auth.tenantId).page(runId, after, limit); }
  async getRunDiagnostics(runId: string) {
    const run = await this.getRun(runId), database = databaseFor(this.env);
    const [evidence, artifacts] = await Promise.all([
      new TraceProjectionRepository(database, this.auth.tenantId).diagnostics(runId),
      new ArtifactRepository(database, this.auth.tenantId).list(runId),
    ]);
    const primary = run.trace_sources?.primary ?? null;
    return { runId: run.id, jobId: run.job_id, state: run.state, provider: run.provider, backendKind: run.execution_backend_kind,
      execution: run.execution_diagnostics, traceSources: run.trace_sources,
      trace: { ...evidence, provider: primary?.provider ?? artifacts.find(item => item.kind === "native_session")?.provider ?? run.agent_kind ?? null, primarySource: primary?.kind ?? "native_session", sourceVersion: primary?.formatVersion ?? null,
        artifacts: artifacts.filter(item => ["execution_stream", "native_session"].includes(item.kind)),
        nativeArtifactState: primary?.provider === "codex" && primary.kind === "execution_stream" ? "not_applicable" : artifacts.some(item => item.kind === "native_session" && item.state === "stored") ? "stored" : "missing",
        fallbackUsed: evidence.projection?.source_kind === "native_session" && primary?.kind === "execution_stream" },
      harnessLog: run.harness_log, artifact: { state: run.artifact_state, error: run.artifact_error }, activity: run.activity, createdAt: run.created_at, updatedAt: run.updated_at };
  }
  async replayRunTrace(runId: string, body: unknown) {
    await this.authorizeOwnerSession("runs:write");
    const input = traceReplaySchema.parse(body);
    traceReplayRunIdSchema.parse(runId);
    try { return await replayTrace(this.env, this.auth.tenantId, this.auth.userId, runId, input); }
    catch (error) { if (error instanceof TraceReplayError) throw new ServiceError(error.status, error.code, error.message); throw error; }
  }
  async stopRun(runId: string) { await this.authorize("runs:write"); const stopped = await new RunQueryRepository(databaseFor(this.env), this.auth.tenantId).stop(runId); if (!stopped) throw new ServiceError(409, "operation_failed", "Run is not active"); if (this.env.SCHEDULER) await this.env.SCHEDULER.get(this.env.SCHEDULER.idFromName("global")).fetch("https://scheduler/wake", { method: "POST" }); return stopped; }
  killRun(runId: string) { return this.stopRun(runId); }
  async listJobSummaries(input: JobPageQuery, selector = false) { await this.authorize("flows:read"); return new JobSummaryRepository(databaseFor(this.env), this.auth.tenantId).page(input, selector); }
  async listJobs() { await this.authorize("flows:read"); const jobs = await this.jobs().list(), stats = await this.jobStatistics(jobs.map(job => job.id)); return Promise.all(jobs.map(job => this.presentJob(job, stats.get(job.id) ?? { running_count: "0", last_run_state: null }))); }
  async getJob(jobId: string) { await this.authorize("flows:read"); const job = await this.jobs().getJob(jobId); if (!job) throw new ServiceError(404, "not_found", "Job not found"); return this.presentJob(job); }
  async listJobEvents(jobId: string, limit = 50) { await this.authorize("runs:read"); return new OperationsRepository(databaseFor(this.env), this.auth.tenantId).jobEvents(jobId, limit); }
  async listWebhookDeliveries(query: URLSearchParams) { await this.authorize("runs:read"); return new OperationsRepository(databaseFor(this.env), this.auth.tenantId).deliveries(query); }
  async getWebhookDelivery(deliveryId: string) { await this.authorize("runs:read"); const value = await new OperationsRepository(databaseFor(this.env), this.auth.tenantId).delivery(deliveryId); if (!value) throw new ServiceError(404,"not_found","Webhook delivery not found"); return value; }
  async testJobConditions(input: unknown) { await this.authorize("flows:write"); const parsed = jobConditionsTestSchema.parse(input); return evaluateWebhookConditions(parsed.conditions, parsed.webhook); }
  async createJob(input: JobInput) {
    await this.authorize("flows:write"); const timestamp = new Date().toISOString(), id = crypto.randomUUID();
    const triggers = this.normalizedTriggers(input.triggers).map(trigger => ({ ...trigger, jobId: id }));
    const job: Job = { id, name: input.name, slug: input.slug, promptTemplate: input.promptTemplate, runNameTemplate: input.runNameTemplate ?? "", model: input.model ?? "", ...(input.effort ? { effort: input.effort } : {}), executionTarget: await this.executionTarget(input.executionTargetId), concurrencyLimit: input.concurrencyLimit, enabled: true, triggers, createdAt: timestamp, updatedAt: timestamp };
    try { return this.presentJob(await this.jobs().create(job)); } catch (error: any) { if (error?.code === "23505") throw new ServiceError(409, "conflict", "Job slug is already in use"); throw error; }
  }
  async updateJob(jobId: string, input: JobInput & { expectedUpdatedAt?: string }) {
    await this.authorize("flows:write"); const repository = this.jobs(), current = await repository.getJob(jobId); if (!current) throw new ServiceError(404, "not_found", "Job not found");
    const triggers = this.normalizedTriggers(input.triggers, current.triggers).map(trigger => ({ ...trigger, jobId }));
    const updated = await repository.update({ ...current, name: input.name, slug: input.slug, promptTemplate: input.promptTemplate, runNameTemplate: input.runNameTemplate ?? "", model: input.model ?? "", effort: input.effort, executionTarget: await this.executionTarget(input.executionTargetId), concurrencyLimit: input.concurrencyLimit, triggers, updatedAt: new Date().toISOString() }, input.expectedUpdatedAt).catch(error => { if (error instanceof StaleJobEdit) throw new ServiceError(409, "stale_job", "This job changed. Reload its configuration before saving."); throw error; });
    await this.wakeScheduler();
    return this.presentJob(updated);
  }
  async deleteJob(jobId: string) {
    await this.authorize("flows:write");
    const database = databaseFor(this.env), repository = this.jobs();
    if (!await repository.getJob(jobId)) throw new ServiceError(404, "not_found", "Job not found");
    const objectKeys = await new ArtifactRepository(database, this.auth.tenantId).keysForJob(jobId);
    if (objectKeys.length && !this.env.RUN_ARTIFACTS) throw new ServiceError(503, "operation_failed", "Artifact storage is unavailable");
    // R2 is outside the PostgreSQL transaction. Delete the objects first and
    // retain the database aggregate if object deletion fails so the operation
    // can be retried without losing the authoritative object-key inventory.
    for (let offset = 0; offset < objectKeys.length; offset += 1_000) await this.env.RUN_ARTIFACTS!.delete(objectKeys.slice(offset, offset + 1_000));
    if (!await repository.delete(jobId)) throw new ServiceError(404, "not_found", "Job not found");
    return { id: jobId, deleted: true };
  }
  private async wakeScheduler() {
    if (this.env.SCHEDULER) await this.env.SCHEDULER.get(this.env.SCHEDULER.idFromName("global")).fetch("https://scheduler/wake", { method: "POST" });
  }
  async setJobEnabled(jobId: string, enabled: boolean) { await this.authorize("flows:write"); const repository = this.jobs(); if (!await repository.setEnabled(jobId, enabled, new Date().toISOString())) throw new ServiceError(404, "not_found", "Job not found"); await this.wakeScheduler(); return { id: jobId, enabled }; }
  async invokeJob(jobId: string, input: ManualInvocationInput) {
    await this.authorize("runs:write"); const repository = this.jobs(), job = await repository.getJob(jobId); if (!job) throw new ServiceError(404, "not_found", "Job not found");
    const trigger = job.triggers.find(value => value.kind === "manual" && value.enabled); if (!trigger) throw new ServiceError(409, "operation_failed", "The manual trigger is disabled");
    const service = new InvocationService(repository, value => encrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY));
    const result = await service.invoke(jobId, { source: "manual", name: input.name, triggerId: trigger.id, claimKey: input.idempotencyKey ? `manual:${input.idempotencyKey}` : `manual:${crypto.randomUUID()}`, context: { [trigger.slug]: { prompt: input.prompt, data: input.data ?? {} } } });
    if (this.env.SCHEDULER) await this.env.SCHEDULER.get(this.env.SCHEDULER.idFromName("global")).fetch("https://scheduler/wake", { method: "POST" });
    return { invocationId: result.invocation.id, runId: result.run.id, state: result.run.state, duplicate: result.duplicate };
  }
  async listExecutionTargets() {
    await this.authorize("flows:read"); const connections = await this.connections().all(["exe:", "amp:"]); const targets: any[] = [];
    for (const [kind, value] of connections) if (kind.startsWith("exe:")) { const id = kind.slice(4); targets.push({ id, kind: "exe-vm", name: "Ephemeral exe.dev VMs", workspace: "ephemeral", cwd: "/home/exedev/workspace", agentKind: value.agentKind, models: value.models ?? [], modelsRefreshedAt: value.modelsRefreshedAt ?? null, efforts: value.agentKind === "codex" ? ["minimal", "low", "medium", "high", "xhigh"] : [], capabilities: ["recovery", "stop"] }); }
    else if (kind.startsWith("amp:")) { const id = kind.slice(4); targets.push({ id: `amp:${id}`, kind: "amp", name: `Amp · ${value.project}`, workspace: value.project, cwd: "Cloud orb", agentKind: "Amp", capabilities: ["stop"] }); }
    return publicValue(z.array(executionTargetResponse), targets);
  }
  async diagnoseExeIntegration(connectionId: string) { await this.authorize("flows:write"); const value = await new IntegrationService(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY).diagnoseExe(connectionId); if (!value) throw new ServiceError(404,"not_found","Integration not found"); return value; }
  async listJobTriggerAvailability() { await this.authorize("flows:read"); const [kinds, installations] = await Promise.all([this.connections().kinds(), new GitHubRepository(databaseFor(this.env),this.auth.tenantId).installations()]), states=installations.map((x:any)=>x.state); return installedTriggerAvailability(kinds.includes("linear"),kinds.includes("clickup"),states,kinds.filter(x=>x.startsWith("cloudflare-tail:")).length); }
  async previewSchedule(input: unknown) {
    await this.authorize("flows:read");
    try {
      const config = validateScheduleConfig(input);
      return { nextRunAt: nextOccurrence(config, new Date()).toISOString() };
    } catch (error) {
      throw new ServiceError(400, "invalid_request", error instanceof Error ? error.message : "Invalid schedule");
    }
  }

  private integrations() { return new IntegrationService(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY); }
  private providers() { return new ProviderCatalog(databaseFor(this.env), this.env, this.auth.tenantId); }

  async integrationStatus() { await this.authorize("flows:read"); return publicValue(integrationStatus, await this.integrations().status()); }
  async saveExeIntegration(input: any) { await this.authorize("flows:write"); return this.integrations().saveExe(input); }
  async testExeIntegration(input: any) { await this.authorize("flows:write"); return this.integrations().testExe(input); }
  async removeIntegration(kind: "exe" | "amp", id: string) { await this.authorize("flows:write"); const result = await this.integrations().remove(kind, id); if (result.conflict) throw new ServiceError(409, "conflict", "This integration is used by a job."); if (!result.deleted) throw new ServiceError(404, "not_found", "Integration not found"); return { id, deleted: true }; }
  async saveAmpIntegration(input: any) { await this.authorize("flows:write"); return this.integrations().saveAmp(input); }
  async testAmpIntegration(input: any) { await this.authorize("flows:write"); return this.integrations().testAmp(input); }
  async saveTailIntegration(input: any) { await this.authorize("flows:write"); return this.integrations().saveTail(input); }
  async testTailIntegration(id: string) { await this.authorize("flows:write"); const result = await this.integrations().testTail(id); if (!result) throw new ServiceError(404, "not_found", "Integration not found"); return result; }
  async removeTailIntegration(id: string) { await this.authorize("flows:write"); if (!await this.connections().delete(`cloudflare-tail:${id}`)) throw new ServiceError(404, "not_found", "Integration not found"); return { id, deleted: true }; }
  async linearProjects() { await this.authorize("flows:read"); return publicValue(z.array(namedOption), await this.providers().linearProjects()); }
  async linearOptions() { await this.authorize("flows:read"); return publicValue(providerOptions, await this.providers().linearOptions()); }
  async clickUpLists() { await this.authorize("flows:read"); return publicValue(z.array(namedOption), await this.providers().clickUpLists()); }
  async clickUpOptions(listId: string) { await this.authorize("flows:read"); return publicValue(providerOptions, await this.providers().clickUpOptions(listId)); }
  async githubRepositories(installationId: number) { await this.authorize("flows:read"); return publicValue(z.array(githubRepository), await this.providers().githubRepositories(installationId)); }
  async githubIssueOptions(installationId: number, repositoryId: number) { await this.authorize("flows:read"); return publicValue(providerOptions, await this.providers().githubIssueOptions(installationId, repositoryId)); }
  async removeGitHubInstallation(id: number) { await this.authorize("flows:write"); if (!await new GitHubRepository(databaseFor(this.env), this.auth.tenantId).delete(id)) throw new ServiceError(404, "not_found", "Installation not found"); return { id, deleted: true }; }

  async listAuthorizedClients() {
    await this.authorizeOwnerSession("flows:read");
    if (!this.env.OAUTH_PROVIDER) throw new ServiceError(503, "operation_failed", "OAuth management unavailable");
    const grants: any[] = []; let cursor: string | undefined;
    do { const page = await this.env.OAUTH_PROVIDER.listUserGrants(this.auth.userId, { limit: 100, cursor }); grants.push(...page.items.filter(grant => !grant.expiresAt || grant.expiresAt > Math.floor(Date.now() / 1000))); cursor = page.cursor; } while (cursor);
    const clients = await Promise.all([...new Set(grants.map(grant => grant.clientId))].map(async clientId => [clientId, await this.env.OAUTH_PROVIDER!.lookupClient(clientId)] as const));
    const byId = new Map(clients);
    return publicValue(z.array(authorizedClient), grants.map(grant => ({ grantId: grant.id, clientId: grant.clientId, clientName: byId.get(grant.clientId)?.clientName ?? grant.clientId, scopes: grant.scope, authorizationDate: new Date(grant.createdAt * 1000).toISOString(), expiresAt: grant.expiresAt ? new Date(grant.expiresAt * 1000).toISOString() : null, lastUsedAt: null })));
  }
  async revokeAuthorizedClient(clientId: string) { await this.authorizeOwnerSession("flows:write"); if (!this.env.OAUTH_PROVIDER) throw new ServiceError(503, "operation_failed", "OAuth management unavailable"); const grants: any[] = []; let cursor: string | undefined; do { const page = await this.env.OAUTH_PROVIDER.listUserGrants(this.auth.userId, { limit: 100, cursor }); grants.push(...page.items.filter(grant => grant.clientId === clientId)); cursor = page.cursor; } while (cursor); await Promise.all(grants.map(grant => this.env.OAUTH_PROVIDER!.revokeGrant(grant.id, this.auth.userId))); return { revoked: grants.length }; }
  async listAccessTokens() { await this.authorizeOwnerSession("flows:read"); return publicValue(z.array(accessToken), JSON.parse(JSON.stringify(await new AccessTokenRepository(databaseFor(this.env), this.auth.tenantId).list()))); }
  async createAccessToken(input: any) { await this.authorizeOwnerSession("flows:write"); const name = typeof input?.name === "string" ? input.name.trim() : "", requested: string[] = Array.isArray(input?.scopes) ? [...new Set<string>(input.scopes.filter((scope: unknown): scope is string => typeof scope === "string"))] : [], expiryDays = Number(input?.expiryDays); if (!name || name.length > 100 || !requested.length || requested.some(scope => !ACCESS_SCOPES.includes(scope as any)) || ![7, 30, 90].includes(expiryDays)) throw new ServiceError(400, "invalid_request", "A name, supported scopes, and expiryDays of 7, 30, or 90 are required."); const token = issueAccessToken(this.auth.tenantId), expiresAt = new Date(Date.now() + expiryDays * 86_400_000).toISOString(); const metadata = await new AccessTokenRepository(databaseFor(this.env), this.auth.tenantId).create({ name, scopes: requested, expiresAt, digest: await accessTokenDigest(token), userId: this.auth.userId, sessionVersion: this.auth.sessionVersion }); if (!metadata) throw new ServiceError(401, "invalid_token", "The owner session is no longer active."); return publicValue(createdAccessToken, JSON.parse(JSON.stringify({ ...metadata, token }))); }
  async revokeAccessToken(id: string) { await this.authorizeOwnerSession("flows:write"); if (!await new AccessTokenRepository(databaseFor(this.env), this.auth.tenantId).revoke(id)) throw new ServiceError(404, "not_found", "Access token not found"); return { revoked: true }; }
}
