import { DEFAULT_RUN_SCOPES } from "./run-scopes";
import { searchResponse } from "./search-contracts";
import { integrationStatus, exeConnection, accessToken, createdAccessToken, authorizedClient } from "./settings-contracts";
import { namedOption, providerOptions, githubRepository, githubInstallation, tailIntegration } from "./editor-contracts";
import { z } from "zod";
import { runPageResponse, fullRunResponse, runtimeContextResponse } from "./run-read-contracts";
import { triggerContextCatalog } from "./trigger-context";
import type { Env, OAuthProps } from "./types";
import { canonicalizeVmImage, renameRunSchema, reportRunErrorSchema, vmImageVerificationInput, type JobInput, type ManualInvocationInput } from "./flow-schemas";
import { nextOccurrence, validateScheduleConfig } from "./schedule";
import { databaseFor } from "./postgres/database";
import { IdentityRepository } from "./postgres/identity-repository";
import { AccessTokenRepository } from "./postgres/access-token-repository";
import { InvalidJobSummaryCursor, JobSummaryRepository } from "./postgres/job-summary-repository";
import { jobResponse } from "./job-contracts";
import type { JobPageQuery } from "./job-contracts";
import { PostgresJobRepository, StaleJobEdit } from "./postgres/job-repository";
import { ConnectionRepository } from "./postgres/connection-repository";
import { EncryptedIntegrationRepository, IntegrationIdempotencyConflictError, IntegrationValidationError, StaleIntegrationRevisionError } from "./postgres/encrypted-integration-repository";
import { ProxyControlRepository } from "./postgres/proxy-control-repository";
import { issueModelAccountCapability } from "./proxy-browser-capability";
import { decrypt, encrypt } from "./crypto";
import { InvocationService, type Job, type Trigger } from "./job-domain";
import { RunQueryRepository } from "./postgres/run-query-repository";
import { TraceRepository } from "./postgres/trace-repository";
import { GitHubRepository } from "./postgres/github-repository";
import { IntegrationService } from "./postgres/integration-service";
import { OperationsRepository } from "./postgres/operations-repository";
import { installedTriggerAvailability } from "./trigger-availability";
import { evaluateWebhookConditions } from "./webhook-conditions";
import { jobConditionsTestSchema, invocationPermissionsResponse } from "./flow-schemas";
import { ProviderCatalog } from "./postgres/provider-catalog";
import { ArtifactRepository } from "./postgres/artifact-repository";
import { ACCESS_SCOPES, accessTokenDigest, issueAccessToken, normalizeScopes } from "./access-tokens";

import { TraceProjectionRepository } from "./postgres/trace-projection-repository";
import { replayTrace, traceReplaySchema, traceReplayRunIdSchema, TraceReplayError } from "./trace-replay";
import { ProjectRepository } from "./postgres/project-repository";
import { effortOptions, selectableExeTags, type ExeConnection } from "./exe";
import { ExeImageVerificationError, ExeVmBackend } from "./exe-vm-backend";
import { SkillRepository, SkillConflict, SkillReferenced } from "./postgres/skill-repository";
import { RunRepository } from "./postgres/run-repository";
import { safeDiagnosticText } from "./harness-diagnostics";
import { skillInput, skillUpdateInput, skillPage, skillResponse, skillJobsResponse, previewSkillInput, composePrompt } from "./skills";
import { createFlyAccountClient, FlyAccountError, flyConnectionInput } from "./fly-account-client";
import { FlyConnectionRepository } from "./postgres/fly-connection-repository";
import { FlyExecutionConfigurationRepository } from "./postgres/fly-execution-configuration-repository";
import { flyExecutionConfigurationInput, getFlyExecutionMetadata, type FlyExecutionMetadataLoader } from "./fly-execution-configurations";

const PROJECT_GRAPH_LABEL_MAX_CHARS = 24;

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

type Scope = "projects:read" | "projects:write" | "jobs:read" | "jobs:write" | "runs:read" | "runs:invoke" | "runs:cancel" | "runs:write" | "integrations:read" | "integrations:write" | "skills:read" | "skills:write";

export class ApiService {
  authorizationDuration = 0;
  constructor(private env: Env, private auth: OAuthProps, private ctx?: ExecutionContext, private flyMetadata: FlyExecutionMetadataLoader = getFlyExecutionMetadata) {}

  private jobs() { return new PostgresJobRepository(databaseFor(this.env), this.auth.tenantId, value => encrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY), value => decrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY)); }
  private connections() { return new ConnectionRepository(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY); }
  private flyConnections() { return new FlyConnectionRepository(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY); }
  private projects() { return new ProjectRepository(databaseFor(this.env), this.auth.tenantId); }
  private skills() { return new SkillRepository(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY); }
  private async executionConfig(id: string) {
    // Target IDs created by the migration are deterministic md5-derived UUIDs,
    // so they do not necessarily have RFC 4122 version/variant bits. Any
    // UUID-shaped value is still safe to use in the UUID query; non-UUID values
    // are the legacy connection IDs.
    if (id.startsWith("amp:")) {
      const connectionId = id.slice(4), value = await this.connections().get<{ project: string }>(`amp:${connectionId}`);
      if (!value) throw new ServiceError(400, "invalid_request", "execution integration not found");
      return { targetId: id, connectionId, workspace: value.project, cwd: "", agentKind: "Amp", tags: [] };
    }
    const value = await this.connections().get<{ agentKind: string; tags?: string[] }>(`exe:${id}`);
    if (value) return { targetId: id, connectionId: id, workspace: "ephemeral", cwd: "/home/exedev/workspace", agentKind: value.agentKind, tags: value.tags ?? [], executionProvider: "exe" as const };
    const fly = await this.flyExecutionConfigs().get(id);
    if (!fly) throw new ServiceError(400, "invalid_request", "execution integration not found");
    if (!await this.flyConnections().get()) throw new ServiceError(409, "fly_connection_required", "Connect a Fly account before selecting this execution configuration.");
    return { targetId: id, connectionId: id, workspace: "", cwd: "", agentKind: "codex", tags: [], image: fly.image, region: fly.region, size: fly.size, executionProvider: "fly" as const };
  }

  private async portableSelections(config: Awaited<ReturnType<ApiService["executionConfig"]>>, executionType: "agent" | "code", input: JobInput, current?: Job) {
    const portableIntegrationIds = input.portableIntegrationIds ?? current?.portableIntegrationIds ?? current?.executionConfig.portableIntegrationIds ?? [];
    if (executionType === "code" && input.modelAccess === "portable") throw new ServiceError(400, "invalid_request", "Code jobs cannot select model access.");
    const modelAccess = executionType === "code" ? "native" : input.modelAccess ?? current?.modelAccess ?? current?.executionConfig.modelAccess ?? (config.executionProvider === "fly" ? "portable" : "native");
    if (modelAccess === "native" && input.modelAccountId) throw new ServiceError(400, "invalid_request", "Native model access cannot select a portable model account.");
    const modelAccountId = modelAccess === "portable" ? input.modelAccountId ?? current?.modelAccountId ?? current?.executionConfig.modelAccountId : undefined;
    if (executionType === "code" && modelAccountId) throw new ServiceError(400, "invalid_request", "Code jobs cannot select a model account.");
    if (config.executionProvider === "fly" && executionType === "agent" && config.agentKind === "codex" && (!modelAccountId || modelAccess !== "portable")) throw new ServiceError(400, "invalid_request", "Fly Codex jobs require a portable model account.");
    const records = await new EncryptedIntegrationRepository(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY).records();
    const byId = new Map(records.map(record => [record.id, record]));
    if (new Set(portableIntegrationIds).size !== portableIntegrationIds.length || portableIntegrationIds.some(id => byId.get(id)?.kind !== "bearer")) throw new ServiceError(400, "invalid_request", "One or more selected portable integrations are unavailable.");
    if (modelAccountId && byId.get(modelAccountId)?.kind !== "model") throw new ServiceError(400, "invalid_request", "The selected model account is unavailable.");
    if (modelAccess === "portable" && executionType !== "code" && !modelAccountId) throw new ServiceError(400, "invalid_request", "Portable model access requires a model account.");
    return { portableIntegrationIds, modelAccess, ...(modelAccountId ? { modelAccountId } : {}) };
  }

  private async validateExecutionOptions(id: string, model: string, effort: string, tags: string[]) {
    if (id.startsWith("amp:")) return;
    const connection = await this.connections().get<ExeConnection>(`exe:${id}`);
    if (!connection) {
      if (await this.flyExecutionConfigs().get(id)) return;
      throw new ServiceError(400, "invalid_request", "execution integration not found");
    }
    const availableModels = connection.modelsByAgent?.[connection.agentKind ?? "codex"] ?? connection.models ?? [];
    const availableEfforts = effortOptions[connection.agentKind ?? "codex"] ?? [];
    if (model && availableModels.length && !availableModels.includes(model)) throw new ServiceError(400, "invalid_request", "Model is not available on this agent.");
    if (effort && availableEfforts.length && !availableEfforts.includes(effort)) throw new ServiceError(400, "invalid_request", "Effort is not available on this agent.");
    const availableTags = new Set(selectableExeTags(connection));
    if (tags.some(tag => !availableTags.has(tag))) throw new ServiceError(400, "invalid_request", "VM tags must be selected from the available exe.dev labels.");
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
  private async skillSelections(ids: string[]) {
    if (new Set(ids).size !== ids.length) throw new ServiceError(400, "invalid_request", "A skill may only be selected once per job.");
    const values = await Promise.all(ids.map(id => this.skills().get(id)));
    if (values.some(value => !value)) throw new ServiceError(400, "invalid_request", "One or more selected skills are unavailable.");
    return values.map((value, position) => ({ id: value!.id, key: value!.key, revision: value!.revision, body: value!.body ?? "", position }));
  }

  private async jobStatistics(ids: string[]) {
    if (!ids.length) return new Map<string, { running_count: string; last_run_state: string | null }>();
    const result = await databaseFor(this.env).pool.query<{ job_id: string; running_count: string; last_run_state: string | null }>(`
      SELECT selected.job_id,active.running_count,latest.state last_run_state
      FROM unnest($2::uuid[]) selected(job_id)
      CROSS JOIN LATERAL (
        SELECT count(*)::text running_count FROM app.job_runs r
        WHERE r.tenant_id=$1 AND r.job_id=selected.job_id
          AND r.state IN ('reserved','starting','running','blocked','stopping')
      ) active
      LEFT JOIN LATERAL (
        SELECT r.state FROM app.job_runs r
        WHERE r.tenant_id=$1 AND r.job_id=selected.job_id
        ORDER BY r.created_at DESC,r.id DESC LIMIT 1
      ) latest ON true`, [this.auth.tenantId, ids]);
    return new Map(result.rows.map(row => [row.job_id, row]));
  }

  private async presentJob(job: Job, loadedStats?: { running_count: string; last_run_state: string | null }) {
    const stats = loadedStats ?? (await this.jobStatistics([job.id])).get(job.id);
    const runningCount = Number(stats?.running_count ?? 0);
    return publicValue(jobResponse, { ...job, runScopes: job.runScopes ?? [...DEFAULT_RUN_SCOPES], executionType: job.executionType ?? "agent", skills: (job.selectedSkills ?? []).map(skill => ({ id: skill.id, key: skill.key, revision: skill.revision, position: skill.position })), triggers: job.triggers.map(trigger => ({ ...trigger, config: trigger.kind === "webhook" ? { ...trigger.config, ...(trigger.config.signingSecret || trigger.config.secret ? { secretConfigured: true } : {}), ...(trigger.config.provider === "cloudflareTail" ? { destination: `${this.env.APP_ORIGIN}/webhooks/cloudflare/${encodeURIComponent(this.auth.tenantId)}/${encodeURIComponent(job.id)}` } : {}) } : trigger.config })), runNameTemplate: job.runNameTemplate ?? "", executionConfigId: job.executionConfig.targetId ?? `${job.executionConfig.agentKind === "Amp" ? "amp:" : ""}${job.executionConfig.connectionId}`, agentKind: job.executionConfig.agentKind, runningCount, currentRuns: runningCount, maxConcurrency: job.concurrencyLimit, lastRunState: stats?.last_run_state ?? null });
  }
  async listSkills(query: { q: string; limit: number; cursor?: string }) { await this.authorize("skills:read"); return publicValue(skillPage, await this.skills().list(query.q, query.limit, query.cursor)); }
  async getSkill(id: string) { await this.authorize("skills:read"); const value = await this.skills().get(id); if (!value) throw new ServiceError(404, "not_found", "Skill not found"); return publicValue(skillResponse, value); }
  async createSkill(input: unknown) { await this.authorize("skills:write"); return publicValue(skillResponse, await this.skills().create(skillInput.parse(input).key, skillInput.parse(input).body)); }
  async updateSkill(id: string, input: unknown) { await this.authorize("skills:write"); try { const value = await this.skills().update(id, skillUpdateInput.parse(input)); if (!value) throw new ServiceError(404, "not_found", "Skill not found"); return publicValue(skillResponse, value); } catch (e) { if (e instanceof SkillConflict) throw new ServiceError(409, "stale_skill", e.message); throw e; } }
  async deleteSkill(id: string, expectedRevision: number) { await this.authorize("skills:write"); try { if (!await this.skills().remove(id, expectedRevision)) throw new ServiceError(404, "not_found", "Skill not found"); return { id, deleted: true }; } catch (e) { if (e instanceof SkillReferenced) throw new ServiceError(409, "skill_referenced", `${e.message} Jobs: ${e.jobs.map(job => job.name).join(", ")}`); if (e instanceof SkillConflict) throw new ServiceError(409, "stale_skill", e.message); throw e; } }
  async listSkillJobs(id: string) { await this.authorize("skills:read"); return publicValue(skillJobsResponse, { skillId: id, jobs: await this.skills().jobs(id) }); }
  async previewJobPrompt(input: unknown) { await this.authorize("skills:read"); const parsed = previewSkillInput.parse(input); const skills = await Promise.all(parsed.skillIds.map(async id => { const skill = await this.skills().get(id); if (!skill) throw new ServiceError(400, "invalid_request", "A selected skill is unavailable."); return skill; })); return { prompt: composePrompt(skills.map(skill => ({ body: skill.body ?? "" })), parsed.jobContext), skills: skills.map(skill => ({ id: skill.id, key: skill.key, revision: skill.revision })) }; }

  private async authorize(scope: Scope): Promise<void> {
    if (!normalizeScopes(this.auth.scopes).includes(scope)) throw new ServiceError(403, "insufficient_scope", `The ${scope} scope is required.`);
    await this.authorizeIdentity();
  }
  private async authorizeIdentity(): Promise<void> {
    const started = performance.now();
    try {
      const database = databaseFor(this.env);
      const member = await new IdentityRepository(database, this.auth.tenantId).member(this.auth.userId);
      const tokenActive = !this.auth.accessTokenId || await new AccessTokenRepository(database, this.auth.tenantId).active(this.auth.accessTokenId);
      if (member?.role !== "owner" || member.sessionVersion !== this.auth.sessionVersion || !tokenActive) throw new ServiceError(401, "invalid_token", "The request is not authorized.");
    } finally { this.authorizationDuration += performance.now() - started; }
  }
  private async authorizeOwnerSession(scope: Scope): Promise<void> { await this.authorize(scope); if (this.auth.authMethod !== "session") throw new ServiceError(403, "session_required", "An interactive owner session is required."); }

  async getRuntimeContext() {
    await this.authorizeIdentity();
    return publicValue(runtimeContextResponse, { kind: "factorize-runtime-context-v1", authMethod: this.auth.authMethod ?? "oauth", runId: this.auth.runId ?? null, jobId: this.auth.runJobId ?? null, scopes: normalizeScopes(this.auth.scopes) });
  }


  async listExeConnections() { await this.authorize("integrations:read"); return publicValue(z.array(exeConnection), (await new IntegrationService(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY).status()).exeConnections); }
  async getFlyConnection() { await this.authorizeOwnerSession("integrations:read"); return { connection: await this.flyConnections().get() }; }
  async validateFlyConnection(input: unknown) {
    await this.authorizeOwnerSession("integrations:write");
    const parsed = flyConnectionInput.parse(input);
    try { return { valid: true, connection: await createFlyAccountClient().validate(parsed.token, parsed.organizationSlug) }; }
    catch (error) { this.throwFlyAccountError(error); }
  }
  async saveFlyConnection(input: unknown) {
    await this.authorizeOwnerSession("integrations:write");
    const parsed = flyConnectionInput.parse(input);
    try {
      const metadata = await createFlyAccountClient().validate(parsed.token, parsed.organizationSlug);
      return { connection: await this.flyConnections().save(metadata, parsed.token) };
    } catch (error) { this.throwFlyAccountError(error); }
  }
  async removeFlyConnection() { await this.authorizeOwnerSession("integrations:write"); return { deleted: await this.flyConnections().remove() }; }
  private flyExecutionConfigs() { return new FlyExecutionConfigurationRepository(databaseFor(this.env), this.auth.tenantId); }
  async listFlyExecutionConfigurations() { await this.authorizeOwnerSession("integrations:read"); return { configurations: await this.flyExecutionConfigs().list() }; }
  async getFlyExecutionConfiguration(id: string) { await this.authorizeOwnerSession("integrations:read"); const value = await this.flyExecutionConfigs().get(id); if (!value) throw new ServiceError(404, "not_found", "Fly execution configuration not found"); return { configuration: value }; }
  async saveFlyExecutionConfiguration(input: unknown, id?: string) {
    await this.authorizeOwnerSession("integrations:write");
    if (!await this.flyConnections().get()) throw new ServiceError(409, "fly_connection_required", "Connect a Fly account before saving execution configurations.");
    const parsed = flyExecutionConfigurationInput.parse(input), metadata = await this.flyMetadata();
    if (!metadata.regions.includes(parsed.region) || !metadata.sizes.includes(parsed.size)) throw new ServiceError(400, "invalid_fly_configuration", "The selected Fly region or VM size is unavailable.");
    return { configuration: await this.flyExecutionConfigs().save(parsed, id) };
  }
  async removeFlyExecutionConfiguration(id: string) { await this.authorizeOwnerSession("integrations:write"); const deleted = await this.flyExecutionConfigs().remove(id); if (!deleted) throw new ServiceError(404, "not_found", "Fly execution configuration not found"); return { id, deleted: true }; }
  private throwFlyAccountError(error: unknown): never {
    if (error instanceof FlyAccountError) throw new ServiceError(error.kind === "auth" ? 401 : error.kind === "organization" ? 400 : 502, error.kind === "auth" ? "fly_auth_failed" : error.kind === "organization" ? "fly_organization_unavailable" : "fly_validation_failed", error.message);
    throw error;
  }
  async listGitHubInstallations() { await this.authorize("integrations:read"); return publicValue(z.array(githubInstallation), JSON.parse(JSON.stringify(await new GitHubRepository(databaseFor(this.env), this.auth.tenantId).installations()))); }
  async listTailIntegrations() { await this.authorize("integrations:read"); return publicValue(z.array(tailIntegration), await new IntegrationService(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY).tails()); }
  async listRuns(query: URLSearchParams) { await this.authorize("runs:read"); return publicValue(runPageResponse, JSON.parse(JSON.stringify(await new RunQueryRepository(databaseFor(this.env), this.auth.tenantId).list(query)))); }
  async search(query: string) { await this.authorize("jobs:read"); await this.authorize("runs:read"); return publicValue(searchResponse, await new OperationsRepository(databaseFor(this.env), this.auth.tenantId).search(query)); }
  async triggerContextMetadata() { await this.authorize("jobs:read"); return triggerContextCatalog; }
  async getRunStatus(runId: string) { await this.authorize("runs:read"); const status = await new RunQueryRepository(databaseFor(this.env), this.auth.tenantId).status(runId); if (!status) throw new ServiceError(404, "not_found", "Run not found"); return status; }
  async reportRunError(runId: string, input: unknown) {
    await this.authorize("runs:write");
    const parsed = reportRunErrorSchema.parse(input), reason = safeDiagnosticText(parsed.reason, 1000);
    if (!reason.trim()) throw new ServiceError(400, "invalid_request", "Reason must contain safe text.");
    const reporterKind = this.auth.authMethod === "oauth" ? "oauth" : this.auth.authMethod === "access_token" ? "api_key" : this.auth.authMethod === "run_token" ? "run_token" : "session";
    const reporterId = reporterKind === "oauth" ? this.auth.oauthGrantId && this.auth.oauthClientId ? `${this.auth.oauthClientId}:${this.auth.oauthGrantId}` : undefined : reporterKind === "api_key" ? this.auth.accessTokenId : reporterKind === "run_token" ? this.auth.runId : this.auth.userId;
    if (!reporterId) throw new ServiceError(403, "invalid_token", "Authenticated reporter identity is unavailable.");
    const result = await new RunRepository(databaseFor(this.env)).reportAgentError({ tenantId: this.auth.tenantId, runId, reason, userId: this.auth.userId, reporterKind, reporterId });
    if (result === "missing") throw new ServiceError(404, "not_found", "Run not found");
    if (result === "terminal") throw new ServiceError(409, "terminal_run", "Run is already terminal and cannot accept an error report.");
    if (result === "conflict") throw new ServiceError(409, "error_already_reported", "A different error reason was already reported for this run.");
    return { reported: true, reason, retry: result === "identical" };
  }
  async renameRun(runId: string, input: unknown) {
    await this.authorize("runs:write");
    const parsed = renameRunSchema.parse(input);
    const result = await new RunQueryRepository(databaseFor(this.env), this.auth.tenantId).rename(runId, parsed.name, parsed.expectedName);
    if (result === "missing") throw new ServiceError(404, "not_found", "Run not found");
    if (result === "stale") throw new ServiceError(409, "stale_run_name", "This run was renamed. Reload it before saving.");
    return result;
  }
  async getRevisionTrace(runId: string, after: number, limit: number, revision?: string, before?: number, recent = false) { await this.authorize("runs:read"); const page = await new TraceRepository(databaseFor(this.env), this.auth.tenantId).revisionPage(runId, after, limit, revision, before, recent); if (!page) throw new ServiceError(404, "not_found", "Run not found"); return page; }
  async getRun(runId: string) {
    await this.authorize("runs:read");
    const repository = new RunQueryRepository(databaseFor(this.env), this.auth.tenantId);
    const run = await repository.get(runId);
    if (!run) throw new ServiceError(404, "not_found", "Run not found");
    const prompt = await decrypt(run.encrypted_prompt, this.env.CREDENTIAL_ENCRYPTION_KEY);
    delete run.encrypted_prompt; run.prompt = prompt; run.capabilities = run.execution_capabilities; run.backend_kind = run.execution_backend_kind; run.invocation = { id: run.invocation_id, source: run.invocation_source, claim_key: run.invocation_claim_key, trigger_id: run.invocation_trigger_id, context: run.context, occurrence: run.occurrence, source_job_id: run.invocation_source_job_id ?? null, source_run_id: run.invocation_source_run_id ?? null, created_at: run.invocation_created_at };
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
    const agentError = run.agent_error_reason ? { reason: run.agent_error_reason, reported_at: run.agent_error_reported_at, reporter: { user_id: run.agent_error_reporter_user_id, kind: run.agent_error_reporter_kind, id: run.agent_error_reporter_id } } : null;
    return publicValue(fullRunResponse, JSON.parse(JSON.stringify({ id: run.id, tenant_id: run.tenant_id, job_id: run.job_id, invocation_id: run.invocation_id,
      execution_handle: run.execution_handle ? { backendKind: run.execution_handle.backendKind, id: run.execution_handle.id } : null,
      provider: run.provider, issue_id: run.issue_id, issue_url: run.issue_url, issue_title: run.issue_title,
      run_name: run.run_name, agent_name: run.agent_name, workspace_name: run.workspace_name, agent_kind: run.agent_kind, execution_type: run.execution_type ?? run.execution_config?.executionType ?? "agent",
      state: run.state, failure_source: run.failure_source ?? null, failure: run.failure_code && run.failure_reason ? { source: run.failure_source === "agent" ? "run" : "system", code: run.failure_code, reason: run.failure_reason } : null, agent_error: agentError, execution_backend_kind: run.execution_backend_kind, backend_kind: run.backend_kind,
      execution_capabilities: run.execution_capabilities, capabilities: run.capabilities, destination_url: run.destination_url,
      artifact_state: run.artifact_state, artifact_error: run.artifact_error,
      claim_released: run.claim_released, vm_cleanup_attempt: run.vm_cleanup_attempt, cleanup_next_at: run.cleanup_next_at, vm_cleanup_complete: run.vm_cleanup_complete, execution_script: typeof run.execution_config?.script === "string" ? run.execution_config.script : null, execution_configuration: run.execution_config,
      created_at: run.created_at, updated_at: run.updated_at, started_at: run.started_at,
      job_name: run.job_name, prompt: run.prompt, context: run.context, occurrence: run.occurrence, invocation: run.invocation,
      invocation_source: run.invocation_source, invocation_claim_key: run.invocation_claim_key, invocation_trigger_id: run.invocation_trigger_id, invocation_created_at: run.invocation_created_at,
      activity: run.activity, execution_diagnostics: run.execution_diagnostics, trace_sources: run.trace_sources,
      trace_projection: run.trace_projection, trace_generation: run.trace_generation, harness_log: run.harness_log,
      job_result: run.job_result ?? null,
      run_artifacts: artifacts.filter(item => !["execution_stream", "native_session"].includes(item.kind)).map(item => ({ id: item.id, kind: item.kind, provider: String(item.provider ?? ""), format: String(item.format ?? ""), byte_size: Number(item.byte_size), sha256: String(item.sha256 ?? ""), state: String(item.state ?? ""), media_type: item.media_type ?? null, created_at: item.created_at instanceof Date ? item.created_at.toISOString() : String(item.created_at ?? "") })), })));
  }
  async getRunTrace(runId: string, after: number, limit: number) { await this.authorize("runs:read"); return new TraceRepository(databaseFor(this.env), this.auth.tenantId).page(runId, after, limit); }
  async downloadRunArtifact(runId: string, artifactId: string): Promise<Response> {
    await this.authorize("runs:read");
    const row = (await databaseFor(this.env).pool.query<{ object_key: string; format: string; id: string }>("SELECT a.object_key,a.format,a.id FROM app.run_artifacts a JOIN app.runs r ON r.tenant_id=a.tenant_id AND r.id=a.run_id WHERE a.tenant_id=$1 AND a.run_id=$2 AND a.id=$3 AND a.state='stored'", [this.auth.tenantId, runId, artifactId])).rows[0];
    if (!row) throw new ServiceError(404, "not_found", "Artifact not found");
    const object = await this.env.RUN_ARTIFACTS?.get(row.object_key);
    if (!object) throw new ServiceError(404, "not_found", "Artifact bytes are unavailable");
    return new Response(object.body, { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="run-artifact-${row.id}"`, "Cache-Control": "private, no-store" } });
  }
  async getRunDiagnostics(runId: string) {
    const run = await this.getRun(runId), database = databaseFor(this.env);
    const [evidence, artifacts] = await Promise.all([
      new TraceProjectionRepository(database, this.auth.tenantId).diagnostics(runId),
      new ArtifactRepository(database, this.auth.tenantId).list(runId),
    ]);
    const primary = run.trace_sources?.primary ?? null;
    return { runId: run.id, jobId: run.job_id, state: run.state, failureSource: run.failure_source, failure: run.failure, agentError: run.agent_error, provider: run.provider, backendKind: run.execution_backend_kind,
      execution: run.execution_diagnostics, traceSources: run.trace_sources,
      trace: { ...evidence, provider: primary?.provider ?? artifacts.find(item => item.kind === "native_session")?.provider ?? run.agent_kind ?? null, primarySource: primary?.kind ?? "native_session", sourceVersion: primary?.formatVersion ?? null,
        artifacts: artifacts.filter(item => ["execution_stream", "native_session"].includes(item.kind)),
        nativeArtifactState: primary?.provider === "codex" && primary.kind === "execution_stream" ? "not_applicable" : artifacts.some(item => item.kind === "native_session" && item.state === "stored") ? "stored" : "missing",
        fallbackUsed: evidence.projection?.source_kind === "native_session" && primary?.kind === "execution_stream" },
      harnessLog: run.harness_log, artifact: { state: run.artifact_state, error: run.artifact_error }, activity: run.activity, createdAt: run.created_at, updatedAt: run.updated_at };
  }
  async replayRunTrace(runId: string, body: unknown) {
    await this.authorizeOwnerSession("runs:cancel");
    const input = traceReplaySchema.parse(body);
    traceReplayRunIdSchema.parse(runId);
    try { return await replayTrace(this.env, this.auth.tenantId, this.auth.userId, runId, input); }
    catch (error) { if (error instanceof TraceReplayError) throw new ServiceError(error.status, error.code, error.message); throw error; }
  }
  async stopRun(runId: string) { await this.authorize("runs:cancel"); const stopped = await new RunQueryRepository(databaseFor(this.env), this.auth.tenantId).stop(runId); if (!stopped) throw new ServiceError(409, "operation_failed", "Run is not active"); if (this.env.SCHEDULER) await this.env.SCHEDULER.get(this.env.SCHEDULER.idFromName("global")).fetch("https://scheduler/wake", { method: "POST" }); return stopped; }
  killRun(runId: string) { return this.stopRun(runId); }
  async listJobSummaries(input: JobPageQuery, selector = false) { await this.authorize("jobs:read"); try { return await new JobSummaryRepository(databaseFor(this.env), this.auth.tenantId).page(input, selector); } catch (error) { if (error instanceof InvalidJobSummaryCursor) throw new ServiceError(400, "invalid_request", error.message); throw error; } }
  async listJobs() { await this.authorize("jobs:read"); const jobs = await this.jobs().list(), stats = await this.jobStatistics(jobs.map(job => job.id)); return Promise.all(jobs.map(job => this.presentJob(job, stats.get(job.id) ?? { running_count: "0", last_run_state: null }))); }
  async getJob(jobId: string) { await this.authorize("jobs:read"); const job = await this.jobs().getJob(jobId); if (!job) throw new ServiceError(404, "not_found", "Job not found"); return this.presentJob(job); }
  async listProjects(options?: { limit?: number; sort?: "name" | "updated" }) { await this.authorize("projects:read"); return this.projects().list(options); }
  async getProject(projectId: string) { await this.authorize("projects:read"); const project = await this.projects().get(projectId); if (!project) throw new ServiceError(404, "not_found", "Project not found"); return project; }
  async getProjectGraph(projectId: string) {
    await this.authorize("projects:read");
    if (!await this.projects().get(projectId)) throw new ServiceError(404, "not_found", "Project not found");
    const db = databaseFor(this.env), tenantId = this.auth.tenantId;
    const jobs = await db.pool.query<any>(`SELECT j.id,j.name,j.enabled,j.execution_config,j.concurrency_limit,
      (SELECT count(*)::int FROM app.job_runs r WHERE r.tenant_id=j.tenant_id AND r.job_id=j.id AND r.state IN ('reserved','starting','running','blocked','stopping')) running_count,
      COALESCE(jsonb_agg(jsonb_build_object('id',t.id,'kind',t.kind,'enabled',t.enabled,'config',CASE
        WHEN t.kind='jobLifecycle' THEN jsonb_build_object('sourceJobIds',t.config->'sourceJobIds','sourceJobId',t.config->'sourceJobId','states',t.config->'states')
        WHEN t.kind='jobIdle' THEN jsonb_build_object('sourceJobIds',t.config->'sourceJobIds')
        WHEN t.kind='webhook' THEN jsonb_build_object('provider',t.config->>'provider','projectId',t.config->>'projectId','listId',t.config->>'listId','repositoryId',t.config->>'repositoryId','event',t.config->>'event','integrationId',t.config->>'integrationId')
        ELSE '{}'::jsonb END) ORDER BY t.position,t.id) FILTER (WHERE t.id IS NOT NULL),'[]'::jsonb) triggers
      FROM app.jobs j LEFT JOIN app.triggers t ON t.tenant_id=j.tenant_id AND t.job_id=j.id AND t.removed_at IS NULL
      WHERE j.tenant_id=$1 AND j.project_id=$2 GROUP BY j.tenant_id,j.id ORDER BY j.id`, [tenantId, projectId]);
    const ids = new Set<string>(jobs.rows.map(row => row.id));
    const nodes: any[] = jobs.rows.map(row => ({ id: row.id, type: "job", label: row.name, jobKind: row.execution_config?.executionType === "code" ? "Code" : "Agent", enabled: row.enabled, runningCount: Number(row.running_count ?? 0), concurrencyLimit: row.concurrency_limit }));
    const edges: any[] = [];
    const shortLabel = (value: string) => value.length > PROJECT_GRAPH_LABEL_MAX_CHARS ? `${value.slice(0, PROJECT_GRAPH_LABEL_MAX_CHARS - 1).trimEnd()}…` : value;
    const providerLabels: Record<string, string> = { linear: "Linear", clickup: "ClickUp", github: "GitHub", cloudflareTail: "Cloudflare Tail" };
    for (const job of jobs.rows) for (const trigger of job.triggers) {
      if (trigger.kind === "jobLifecycle") for (const source of trigger.config?.sourceJobIds ?? (trigger.config?.sourceJobId ? [trigger.config.sourceJobId] : [])) if (ids.has(source)) {
        const states = (trigger.config?.states ?? []) as string[];
        const fullLabel = states.map(state => ({ succeeded: "Succeeded", failed: "Failed", stopped: "Stopped", edited: "Edited" } as Record<string, string>)[state] ?? state).join(", ") || "Lifecycle";
        edges.push({ id: `${trigger.id}:${source}:${job.id}`, source, target: job.id, label: shortLabel(fullLabel), details: fullLabel, kind: "lifecycle", enabled: Boolean(job.enabled && trigger.enabled) });
      }
      if (trigger.kind === "jobIdle") for (const source of trigger.config?.sourceJobIds ?? []) if (ids.has(source)) edges.push({ id: `${trigger.id}:${source}:${job.id}`, source, target: job.id, label: "Idle", details: "Runs when the source job becomes idle", kind: "idle", enabled: Boolean(job.enabled && trigger.enabled) });
      if (trigger.kind === "webhook") {
        const config = trigger.config ?? {}, provider = String(config.provider ?? "webhook").slice(0, 50), displayProvider = providerLabels[provider] ?? "Webhook";
        const resource = (provider === "linear" ? String(config.projectId ?? "Project") : provider === "clickup" ? String(config.listId ?? "List") : provider === "github" ? String(config.repositoryId ? `Repository ${config.repositoryId}` : config.event ?? "Repository") : provider === "cloudflareTail" ? "Tail" : "External source").slice(0, 120);
        const source = `webhook:${provider}:${resource}`;
        const event = String(config.event ?? "").toLowerCase();
        const label = provider === "github" && ["pull_request", "pull_request_target"].includes(event) ? "GitHub PR" : provider === "github" && event === "issues" ? "GitHub Issue" : provider === "github" && event === "push" ? "GitHub Push" : displayProvider;
        const details = [displayProvider, [config.event, config.action].filter(Boolean).join(" "), resource && !["Tail", "External source"].includes(resource) ? resource : ""].filter(Boolean).join(" · ");
        if (!nodes.some(node => node.id === source)) nodes.push({ id: source, type: "webhook", label: displayProvider, provider, resource });
        edges.push({ id: `${trigger.id}:${source}:${job.id}`, source, target: job.id, label: shortLabel(label), details, kind: "webhook", enabled: Boolean(job.enabled && trigger.enabled) });
      }
    }
    const grants = await db.pool.query<any>(`SELECT p.source_job_id,p.destination_job_id FROM app.manual_invocation_permissions p JOIN app.jobs s ON s.tenant_id=p.tenant_id AND s.id=p.source_job_id JOIN app.jobs d ON d.tenant_id=p.tenant_id AND d.id=p.destination_job_id WHERE p.tenant_id=$1 AND s.project_id=$2 AND d.project_id=$2 ORDER BY p.source_job_id,p.destination_job_id`, [tenantId, projectId]);
    for (const grant of grants.rows) edges.push({ id: `manual:${grant.source_job_id}:${grant.destination_job_id}`, source: grant.source_job_id, target: grant.destination_job_id, label: "Manual", details: "Manual invocation permission", kind: "manual", enabled: Boolean(jobs.rows.find(row => row.id === grant.source_job_id)?.enabled && jobs.rows.find(row => row.id === grant.destination_job_id)?.enabled) });
    return { nodes, edges };
  }
  async createProject(input: { name: string; description?: string }) { await this.authorize("projects:write"); try { return await this.projects().create(input.name, input.description); } catch (error: any) { if (error?.code === "23505") throw new ServiceError(409, "conflict", "A project with this name already exists"); throw error; } }
  async updateProject(projectId: string, input: { name: string; description?: string }) { await this.authorize("projects:write"); const result = await this.projects().update(projectId, input.name, input.description); if (!result) throw new ServiceError(404, "not_found", "Project not found"); return result; }
  async deleteProject(projectId: string) { await this.authorize("projects:write"); const result = await this.projects().remove(projectId); if (result === "missing") throw new ServiceError(404, "not_found", "Project not found"); if (result === "nonempty") throw new ServiceError(409, "conflict", "Move or delete the project's jobs before deleting it"); return { id: projectId, deleted: true }; }
  async listJobEvents(jobId: string, limit = 50) { await this.authorize("runs:read"); return new OperationsRepository(databaseFor(this.env), this.auth.tenantId).jobEvents(jobId, limit); }
  async listWebhookDeliveries(query: URLSearchParams) { await this.authorize("runs:read"); return new OperationsRepository(databaseFor(this.env), this.auth.tenantId).deliveries(query); }
  async getWebhookDelivery(deliveryId: string) { await this.authorize("runs:read"); const value = await new OperationsRepository(databaseFor(this.env), this.auth.tenantId).delivery(deliveryId); if (!value) throw new ServiceError(404,"not_found","Webhook delivery not found"); return value; }
  async testJobConditions(input: unknown) { await this.authorize("jobs:write"); const parsed = jobConditionsTestSchema.parse(input); return evaluateWebhookConditions(parsed.conditions, parsed.webhook); }
  async createJob(input: JobInput) {
    await this.authorize("jobs:write"); const timestamp = new Date().toISOString(), id = crypto.randomUUID();
    const vmImage = input.vmImage ? canonicalizeVmImage(input.vmImage) : input.vmImage;
    const executionType = input.executionType ?? "agent";
    if (executionType === "code" && input.executionConfigId.startsWith("amp:")) throw new ServiceError(400, "invalid_request", "Code jobs require an exe.dev integration.");
    if (executionType !== "code") await this.validateExecutionOptions(input.executionConfigId, input.model ?? "", input.effort ?? "", input.tags ?? []);
    const executionConfig = await this.executionConfig(input.executionConfigId);
    const portable = await this.portableSelections(executionConfig, executionType, input);
    const triggers = this.normalizedTriggers(input.triggers).map(trigger => ({ ...trigger, jobId: id }));
    const projectId = input.projectId ?? await this.projects().defaultProjectId();
    const selectedSkills = executionType === "code" ? [] : input.skillIds ? await this.skillSelections(input.skillIds) : [];
    const job: Job = { id, projectId, runScopes: input.runScopes ?? [...DEFAULT_RUN_SCOPES], name: input.name, description: input.description ?? "", slug: input.slug, promptTemplate: input.promptTemplate ?? "", executionType, script: executionType === "code" ? input.script : undefined, runNameTemplate: input.runNameTemplate ?? "", tags: input.tags ?? [], model: input.model ?? "", ...portable, ...(input.effort ? { effort: input.effort } : {}), executionConfig: { ...executionConfig, ...portable, executionType, ...(input.script ? { script: input.script } : {}), ...(vmImage ? { image: vmImage } : {}) }, concurrencyLimit: input.concurrencyLimit, enabled: true, triggers, selectedSkills, createdAt: timestamp, updatedAt: timestamp };
    try { return this.presentJob(await this.jobs().create(job)); } catch (error: any) { if (error?.code === "23505") throw new ServiceError(409, "conflict", "Job slug is already in use"); throw error; }
  }
  async updateJob(jobId: string, input: JobInput & { expectedUpdatedAt?: string }) {
    await this.authorize("jobs:write"); const repository = this.jobs(), current = await repository.getJob(jobId); if (!current) throw new ServiceError(404, "not_found", "Job not found");
    const vmImage = input.vmImage ? canonicalizeVmImage(input.vmImage) : input.vmImage;
    const executionType = input.executionType ?? current.executionType ?? "agent";
    if (executionType === "code" && input.executionConfigId.startsWith("amp:")) throw new ServiceError(400, "invalid_request", "Code jobs require an exe.dev integration.");
    if (executionType !== "code") await this.validateExecutionOptions(input.executionConfigId, input.model ?? "", input.effort ?? "", input.tags ?? []);
    const executionConfig = await this.executionConfig(input.executionConfigId);
    const portable = await this.portableSelections(executionConfig, executionType, input, current);
    const triggers = this.normalizedTriggers(input.triggers, current.triggers).map(trigger => ({ ...trigger, jobId }));
    const selectedSkills = executionType === "code" ? [] : input.skillIds === undefined ? current.selectedSkills : await this.skillSelections(input.skillIds);
    const updated = await repository.update({ ...current, ...portable, runScopes: input.runScopes ?? current.runScopes ?? [...DEFAULT_RUN_SCOPES], projectId: input.projectId ?? current.projectId, name: input.name, description: input.description ?? current.description ?? "", slug: input.slug, promptTemplate: input.promptTemplate ?? "", executionType, script: executionType === "code" ? input.script : undefined, runNameTemplate: input.runNameTemplate ?? "", tags: input.tags ?? [], model: input.model ?? "", effort: input.effort, executionConfig: { ...executionConfig, ...portable, executionType, ...(input.script ? { script: input.script } : {}), ...(vmImage ? { image: vmImage } : {}) }, concurrencyLimit: input.concurrencyLimit, triggers, selectedSkills, updatedAt: new Date().toISOString() }, input.expectedUpdatedAt).catch(error => { if (error instanceof StaleJobEdit) throw new ServiceError(409, "stale_job", "This job changed. Reload its configuration before saving."); throw error; });
    await this.wakeScheduler();
    return this.presentJob(updated);
  }
  async startVmImageVerification(input: unknown) {
    await this.authorize("jobs:write");
    const value = vmImageVerificationInput.parse(input), connection = await this.connections().get<ExeConnection>(`exe:${value.connectionId}`);
    if (!connection) throw new ServiceError(404, "not_found", "exe.dev integration not found");
    if (value.executionType !== "code" && connection.agentKind !== value.agentKind) throw new ServiceError(400, "invalid_request", "The selected agent does not match this exe.dev integration.");
    const allowedTags = new Set(selectableExeTags(connection));
    if (value.tags.some(tag => !allowedTags.has(tag))) throw new ServiceError(400, "invalid_request", "VM tags must be selected from the available exe.dev labels.");
    const id = crypto.randomUUID(), db = databaseFor(this.env), config = { connectionId: value.connectionId, image: value.image, tags: value.tags, agentKind: value.agentKind, executionType: value.executionType ?? "agent" };
    await db.pool.query("INSERT INTO app.vm_image_verifications(tenant_id,id,status,phase,config) VALUES ($1,$2,'queued','queued',$3)", [this.auth.tenantId, id, config]);
    const task = this.runVmImageVerification(id, connection, value);
    if (this.ctx) this.ctx.waitUntil(task); else void task.catch(error => console.error("VM image verification failed", error));
    return { id, status: "queued", phase: "queued", errorKind: null, error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  }
  private async runVmImageVerification(id: string, connection: ExeConnection, input: z.infer<typeof vmImageVerificationInput>) {
    const db = databaseFor(this.env), update = async (status: string, phase = status, errorKind: string | null = null, error: string | null = null) => {
      await db.pool.query("UPDATE app.vm_image_verifications SET status=$3,phase=$4,error_kind=$5,error=$6,updated_at=now() WHERE tenant_id=$1 AND id=$2", [this.auth.tenantId, id, status, phase, errorKind, error?.slice(0, 500) ?? null]);
    };
    const backend = new ExeVmBackend({ ...connection, tags: input.tags });
    try {
      await update("creating");
      await backend.verifyImage(id, input.image, input.agentKind, phase => update(phase), input.executionType ?? "agent");
      await update("succeeded", input.executionType === "code" ? "Verification passed. Image pull, SSH, and code prerequisites worked at this time." : "Verification passed. Image pull, SSH, and agent prerequisites worked at this time.");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Image verification failed.";
      const cleanup = message.startsWith("cleanup:"), kind = cleanup ? "cleanup" : message.startsWith("ssh:") ? "ssh" : message.startsWith("agent:") ? "agent" : cause instanceof ExeImageVerificationError ? cause.kind : "image_pull";
      await update(cleanup ? "cleanup_failed" : "failed", "Verification failed", kind, message);
    }
  }
  async getVmImageVerification(id: string) {
    await this.authorize("jobs:read");
    const result = await databaseFor(this.env).pool.query<any>("SELECT id,status,phase,error_kind,error,created_at,updated_at FROM app.vm_image_verifications WHERE tenant_id=$1 AND id=$2", [this.auth.tenantId, id]);
    const row = result.rows[0]; if (!row) throw new ServiceError(404, "not_found", "VM image verification not found");
    return { id: row.id, status: row.status, phase: row.phase, errorKind: row.error_kind, error: row.error, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
  }
  async moveJob(jobId: string, projectId: string, expectedUpdatedAt?: string) { await this.authorize("projects:write"); try { return this.presentJob(await this.jobs().move(jobId, projectId, expectedUpdatedAt)); } catch (error) { if (error instanceof StaleJobEdit) throw new ServiceError(409, "stale_job", "This job changed. Reload it before moving it."); if (error instanceof Error && error.message === "Project not found") throw new ServiceError(404, "not_found", "Project not found"); if (error instanceof Error && error.message === "Job not found") throw new ServiceError(404, "not_found", "Job not found"); throw error; } }
  async deleteJob(jobId: string) {
    await this.authorize("jobs:write");
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
  async setJobEnabled(jobId: string, enabled: boolean) { await this.authorize("jobs:write"); const repository = this.jobs(); if (!await repository.setEnabled(jobId, enabled, new Date().toISOString())) throw new ServiceError(404, "not_found", "Job not found"); await this.wakeScheduler(); return { id: jobId, enabled }; }
  async invokeJob(jobId: string, input: ManualInvocationInput) {
    await this.authorize("runs:invoke"); const repository = this.jobs(), job = await repository.getJob(jobId); if (!job) throw new ServiceError(404, "not_found", "Job not found");
    if (this.auth.authMethod === "run_token") {
      if (!this.auth.runId || !this.auth.runJobId) throw new ServiceError(401, "invalid_token", "A verified run identity is required.");
      const permission = await databaseFor(this.env).pool.query(`SELECT 1 FROM app.run_credentials c
        JOIN app.job_runs r ON r.tenant_id=c.tenant_id AND r.id=c.run_id
        JOIN app.manual_invocation_permissions p ON p.tenant_id=c.tenant_id AND p.source_job_id=r.job_id AND p.destination_job_id=$3
        WHERE c.tenant_id=$1 AND c.run_id=$2 AND c.digest=$4 AND c.expires_at>now() AND r.state IN ('reserved','starting','running','blocked','stopping')`, [this.auth.tenantId, this.auth.runId, jobId, this.auth.runCredentialDigest]);
      if (!permission.rowCount) throw new ServiceError(403, "forbidden", "This run is no longer active or its source job is not authorized to invoke the destination.");
    }
    const trigger = job.triggers.find(value => value.kind === "manual" && value.enabled); if (!trigger) throw new ServiceError(409, "operation_failed", "The manual trigger is disabled");
    const service = new InvocationService(repository, value => encrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY));
    const claimKey = input.idempotencyKey ? `manual:${this.auth.authMethod === "run_token" ? `run:${this.auth.runId}:` : ""}${input.idempotencyKey}` : `manual:${crypto.randomUUID()}`;
    const result = await service.invoke(jobId, { source: "manual", name: input.name, triggerId: trigger.id, claimKey, ...(this.auth.authMethod === "run_token" ? { sourceJobId: this.auth.runJobId, sourceRunId: this.auth.runId } : {}), context: { [trigger.slug]: { prompt: input.prompt, data: input.data ?? {} } } });
    if (this.env.SCHEDULER) await this.env.SCHEDULER.get(this.env.SCHEDULER.idFromName("global")).fetch("https://scheduler/wake", { method: "POST" });
    return { invocationId: result.invocation.id, runId: result.run.id, state: result.run.state, duplicate: result.duplicate };
  }
  async getInvocationPermissions(sourceJobId: string) {
    await this.authorize("jobs:read");
    if (!await this.jobs().getJob(sourceJobId)) throw new ServiceError(404, "not_found", "Job not found");
    const rows = await databaseFor(this.env).pool.query<{ destination_job_id: string }>("SELECT destination_job_id FROM app.manual_invocation_permissions WHERE tenant_id=$1 AND source_job_id=$2 ORDER BY destination_job_id", [this.auth.tenantId, sourceJobId]);
    return publicValue(invocationPermissionsResponse, { sourceJobId, destinationJobIds: rows.rows.map(row => row.destination_job_id) });
  }
  async setInvocationPermissions(sourceJobId: string, destinationJobIds: string[]) {
    await this.authorize("jobs:write");
    // Run credentials intentionally have a read/invoke-only scope set. Keep this
    // service guard as defense in depth if a future run credential gains scopes.
    if (this.auth.authMethod === "run_token") throw new ServiceError(403, "insufficient_scope", "Run credentials cannot change invocation permissions.");
    const unique = [...new Set(destinationJobIds)];
    if (unique.length !== destinationJobIds.length) throw new ServiceError(400, "invalid_request", "Destination jobs must be unique.");
    const db = databaseFor(this.env);
    await db.transaction(async client => {
      const sources = await client.query("SELECT 1 FROM app.jobs WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [this.auth.tenantId, sourceJobId]);
      if (!sources.rowCount) throw new ServiceError(404, "not_found", "Source job not found");
      if (unique.length) {
        const found = await client.query("SELECT id FROM app.jobs WHERE tenant_id=$1 AND id=ANY($2::uuid[])", [this.auth.tenantId, unique]);
        if (found.rowCount !== unique.length) throw new ServiceError(400, "invalid_request", "Every destination must be an existing job in this tenant.");
      }
      await client.query("DELETE FROM app.manual_invocation_permissions WHERE tenant_id=$1 AND source_job_id=$2", [this.auth.tenantId, sourceJobId]);
      if (unique.length) await client.query("INSERT INTO app.manual_invocation_permissions(tenant_id,source_job_id,destination_job_id) SELECT $1,$2,unnest($3::uuid[])", [this.auth.tenantId, sourceJobId, unique]);
    });
    return publicValue(invocationPermissionsResponse, { sourceJobId, destinationJobIds: unique });
  }
  async diagnoseExeIntegration(connectionId: string) { await this.authorize("integrations:write"); const value = await new IntegrationService(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY).diagnoseExe(connectionId); if (!value) throw new ServiceError(404,"not_found","Integration not found"); return value; }
  async listJobTriggerAvailability() { await this.authorize("jobs:read"); const [kinds, installations] = await Promise.all([this.connections().kinds(), new GitHubRepository(databaseFor(this.env),this.auth.tenantId).installations()]), states=installations.map((x:any)=>x.state); return installedTriggerAvailability(kinds.includes("linear"),kinds.includes("clickup"),states,kinds.filter(x=>x.startsWith("cloudflare-tail:")).length); }
  async previewSchedule(input: unknown) {
    await this.authorize("jobs:read");
    try {
      const config = validateScheduleConfig(input);
      return { nextRunAt: nextOccurrence(config, new Date()).toISOString() };
    } catch (error) {
      throw new ServiceError(400, "invalid_request", error instanceof Error ? error.message : "Invalid schedule");
    }
  }

  private integrations() { return new IntegrationService(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY); }
  private providers() { return new ProviderCatalog(databaseFor(this.env), this.env, this.auth.tenantId); }

  async integrationStatus() { await this.authorize("integrations:read"); return publicValue(integrationStatus, await this.integrations().status()); }
  async saveExeIntegration(input: any) { await this.authorize("integrations:write"); return this.integrations().saveExe(input); }
  async testExeIntegration(input: any) { await this.authorize("integrations:write"); return this.integrations().testExe(input); }
  async removeIntegration(kind: "exe" | "amp", id: string) { await this.authorize("integrations:write"); const result = await this.integrations().remove(kind, id); if (result.conflict) throw new ServiceError(409, "conflict", "This integration is used by a job."); if (!result.deleted) throw new ServiceError(404, "not_found", "Integration not found"); return { id, deleted: true }; }
  async saveAmpIntegration(input: any) { await this.authorize("integrations:write"); return this.integrations().saveAmp(input); }
  async testAmpIntegration(input: any) { await this.authorize("integrations:write"); return this.integrations().testAmp(input); }
  async saveTailIntegration(input: any) { await this.authorize("integrations:write"); return this.integrations().saveTail(input); }
  async testTailIntegration(id: string) { await this.authorize("integrations:write"); const result = await this.integrations().testTail(id); if (!result) throw new ServiceError(404, "not_found", "Integration not found"); return result; }
  private encryptedIntegrations() { return new EncryptedIntegrationRepository(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY); }
  private async bearerWrite(input: { id: string; expectedRevision: number; idempotencyKey: string; name: string; origin: string; description: string | null; encryptedPayload?: string; operation: "upsert" | "delete" }) {
    try { return await this.encryptedIntegrations().write({ ...input, kind: "bearer" }); }
    catch (error) {
      if (error instanceof StaleIntegrationRevisionError) throw new ServiceError(409, "stale_revision", `The integration collection changed. Current revision is ${error.currentRevision}.`);
      if (error instanceof IntegrationIdempotencyConflictError) throw new ServiceError(409, "conflict", "The idempotency key was already used for a different integration change.");
      if (error instanceof IntegrationValidationError) throw new ServiceError(400, "invalid_request", error.message);
      throw error;
    }
  }
  private validateBearerOrigin(origin: string) {
    let parsed: URL;
    try { parsed = new URL(origin); } catch { throw new ServiceError(400, "invalid_request", "Integration origin must be an HTTPS origin."); }
    if (parsed.protocol !== "https:" || parsed.origin !== origin || parsed.username || parsed.password) throw new ServiceError(400, "invalid_request", "Integration origin must be an HTTPS origin without credentials, path, query, or fragment.");
  }
  async listBearerIntegrations() {
    await this.authorizeOwnerSession("integrations:read");
    const [revision, records] = await Promise.all([this.encryptedIntegrations().revision(), this.encryptedIntegrations().records("bearer")]);
    return { revision, integrations: records };
  }
  async createBearerIntegration(input: { id: string; expectedRevision: number; idempotencyKey: string; name: string; origin: string; description: string | null; encryptedPayload: string }) {
    await this.authorizeOwnerSession("integrations:write"); this.validateBearerOrigin(input.origin);
    if ((await this.encryptedIntegrations().records("bearer")).some(record => record.id === input.id)) throw new ServiceError(409, "conflict", "Integration already exists.");
    return this.bearerWrite({ ...input, operation: "upsert" });
  }
  async updateBearerIntegration(id: string, input: { expectedRevision: number; idempotencyKey: string; name: string; origin: string; description: string | null; encryptedPayload: string }) {
    await this.authorizeOwnerSession("integrations:write"); this.validateBearerOrigin(input.origin);
    const existing = (await this.encryptedIntegrations().records("bearer")).find(record => record.id === id);
    if (!existing) throw new ServiceError(404, "not_found", "Integration not found.");
    return this.bearerWrite({ ...input, id, operation: "upsert" });
  }
  async deleteBearerIntegration(id: string, input: { expectedRevision: number; idempotencyKey: string }) {
    await this.authorizeOwnerSession("integrations:write");
    const existing = (await this.encryptedIntegrations().records("bearer")).find(record => record.id === id && record.origin !== null);
    if (!existing) throw new ServiceError(404, "not_found", "Integration not found.");
    const result = await this.bearerWrite({ id, name: existing.name, origin: existing.origin!, description: existing.description, ...input, operation: "delete" });
    return { id, deleted: true as const, ...result };
  }
  async getUnlockKeyVerification() {
    await this.authorizeOwnerSession("integrations:read");
    const { rows } = await databaseFor(this.env).pool.query<{ generation_id: string; encrypted_verification: string }>("SELECT generation_id,encrypted_verification FROM app.unlock_key_verifications WHERE tenant_id=$1", [this.auth.tenantId]);
    return { ownerId: this.auth.userId, verification: rows[0] ? { generationId: rows[0].generation_id, encryptedVerification: rows[0].encrypted_verification } : null };
  }
  async createUnlockKeyVerification(input: { generationId: string; encryptedVerification: string }) {
    await this.authorizeOwnerSession("integrations:write");
    let envelope: any;
    try { envelope = JSON.parse(input.encryptedVerification); } catch { throw new ServiceError(400, "invalid_request", "Verification ciphertext is malformed."); }
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || envelope.version !== 1 || envelope.algorithm !== "A256GCM" || Object.keys(envelope).sort().join(",") !== "algorithm,ciphertext,nonce,version" || typeof envelope.nonce !== "string" || !/^[A-Za-z0-9_-]{16}$/u.test(envelope.nonce) || typeof envelope.ciphertext !== "string" || !/^[A-Za-z0-9_-]{22,}$/u.test(envelope.ciphertext)) throw new ServiceError(400, "invalid_request", "Verification ciphertext is malformed.");
    const { rows } = await databaseFor(this.env).pool.query("INSERT INTO app.unlock_key_verifications(tenant_id,generation_id,encrypted_verification) VALUES ($1,$2,$3) ON CONFLICT (tenant_id) DO NOTHING RETURNING generation_id", [this.auth.tenantId, input.generationId, input.encryptedVerification]);
    if (!rows.length) throw new ServiceError(409, "conflict", "An unlock key is already set up for this account.");
    return { generationId: input.generationId };
  }
  async issueModelAccountBrowserCapability(accountId: string, action: "authorize" | "status" | "cancel") {
    await this.authorizeOwnerSession("integrations:write");
    if (!this.env.MODEL_ACCOUNT_CAPABILITY_PRIVATE_KEY) throw new ServiceError(503, "operation_failed", "Model-account browser authorization is unavailable.");
    const [pairing, accounts] = await Promise.all([
      new ProxyControlRepository(databaseFor(this.env)).browserPairing(this.auth.tenantId),
      this.encryptedIntegrations().records("model"),
    ]);
    if (!pairing) throw new ServiceError(503, "operation_failed", "The credential proxy is not paired for browser authorization.");
    if (!accounts.some(account => account.id === accountId)) throw new ServiceError(404, "not_found", "Model account not found.");
    const capability = await issueModelAccountCapability({
      privateKeyPem: this.env.MODEL_ACCOUNT_CAPABILITY_PRIVATE_KEY,
      proxyIdentity: pairing.proxyIdentity, ownerId: this.auth.tenantId, accountId, action,
      appOrigin: this.env.APP_ORIGIN, generation: pairing.bootEpoch,
    });
    return { endpoint: `${pairing.browserOrigin}/model-accounts/${accountId}/${action}`, capability };
  }
  async listModelAccounts() {
    await this.authorizeOwnerSession("integrations:read");
    const accounts = await this.encryptedIntegrations().records("model");
    return { accounts: accounts.map(({ id, name, description, revision }) => ({ id, name, description, revision })) };
  }
  async removeTailIntegration(id: string) { await this.authorize("integrations:write"); if (!await this.connections().delete(`cloudflare-tail:${id}`)) throw new ServiceError(404, "not_found", "Integration not found"); return { id, deleted: true }; }
  async linearProjects() { await this.authorize("integrations:read"); return publicValue(z.array(namedOption), await this.providers().linearProjects()); }
  async linearOptions() { await this.authorize("integrations:read"); return publicValue(providerOptions, await this.providers().linearOptions()); }
  async clickUpLists() { await this.authorize("integrations:read"); return publicValue(z.array(namedOption), await this.providers().clickUpLists()); }
  async clickUpOptions(listId: string) { await this.authorize("integrations:read"); return publicValue(providerOptions, await this.providers().clickUpOptions(listId)); }
  async githubRepositories(installationId: number) { await this.authorize("integrations:read"); return publicValue(z.array(githubRepository), await this.providers().githubRepositories(installationId)); }
  async githubIssueOptions(installationId: number, repositoryId: number) { await this.authorize("integrations:read"); return publicValue(providerOptions, await this.providers().githubIssueOptions(installationId, repositoryId)); }
  async removeGitHubInstallation(id: number) { await this.authorize("integrations:write"); if (!await new GitHubRepository(databaseFor(this.env), this.auth.tenantId).delete(id)) throw new ServiceError(404, "not_found", "Installation not found"); return { id, deleted: true }; }

  async listAuthorizedClients() {
    await this.authorizeOwnerSession("jobs:read");
    if (!this.env.OAUTH_PROVIDER) throw new ServiceError(503, "operation_failed", "OAuth management unavailable");
    const grants: any[] = []; let cursor: string | undefined;
    do { const page = await this.env.OAUTH_PROVIDER.listUserGrants(this.auth.userId, { limit: 100, cursor }); grants.push(...page.items.filter(grant => !grant.expiresAt || grant.expiresAt > Math.floor(Date.now() / 1000))); cursor = page.cursor; } while (cursor);
    const clients = await Promise.all([...new Set(grants.map(grant => grant.clientId))].map(async clientId => [clientId, await this.env.OAUTH_PROVIDER!.lookupClient(clientId)] as const));
    const byId = new Map(clients);
    return publicValue(z.array(authorizedClient), grants.map(grant => ({ grantId: grant.id, clientId: grant.clientId, clientName: byId.get(grant.clientId)?.clientName ?? grant.clientId, scopes: normalizeScopes(grant.scope), authorizationDate: new Date(grant.createdAt * 1000).toISOString(), expiresAt: grant.expiresAt ? new Date(grant.expiresAt * 1000).toISOString() : null, lastUsedAt: null })));
  }
  async revokeAuthorizedClient(clientId: string) { await this.authorizeOwnerSession("jobs:write"); if (!this.env.OAUTH_PROVIDER) throw new ServiceError(503, "operation_failed", "OAuth management unavailable"); const grants: any[] = []; let cursor: string | undefined; do { const page = await this.env.OAUTH_PROVIDER.listUserGrants(this.auth.userId, { limit: 100, cursor }); grants.push(...page.items.filter(grant => grant.clientId === clientId)); cursor = page.cursor; } while (cursor); await Promise.all(grants.map(grant => this.env.OAUTH_PROVIDER!.revokeGrant(grant.id, this.auth.userId))); return { revoked: grants.length }; }
  async listAccessTokens() { await this.authorizeOwnerSession("jobs:read"); return publicValue(z.array(accessToken), (await new AccessTokenRepository(databaseFor(this.env), this.auth.tenantId).list()).map(token => ({ ...token, created_at: new Date(token.created_at).toISOString(), expires_at: new Date(token.expires_at).toISOString(), last_used_at: token.last_used_at ? new Date(token.last_used_at).toISOString() : null, revoked_at: token.revoked_at ? new Date(token.revoked_at).toISOString() : null, scopes: normalizeScopes(token.scopes) }))); }
  async createAccessToken(input: any) { await this.authorizeOwnerSession("jobs:write"); const name = typeof input?.name === "string" ? input.name.trim() : "", requested: string[] = Array.isArray(input?.scopes) ? [...new Set<string>(input.scopes.filter((scope: unknown): scope is string => typeof scope === "string"))] : [], legacy = new Set(["flows:read", "flows:write"]), scopes = normalizeScopes(requested), expiryDays = Number(input?.expiryDays); if (!name || name.length > 100 || !requested.length || requested.some(scope => !ACCESS_SCOPES.includes(scope as any) && !legacy.has(scope)) || !scopes.length || ![7, 30, 90].includes(expiryDays)) throw new ServiceError(400, "invalid_request", "A name, supported scopes, and expiryDays of 7, 30, or 90 are required."); const token = issueAccessToken(this.auth.tenantId), expiresAt = new Date(Date.now() + expiryDays * 86_400_000).toISOString(); const metadata = await new AccessTokenRepository(databaseFor(this.env), this.auth.tenantId).create({ name, scopes, expiresAt, digest: await accessTokenDigest(token), userId: this.auth.userId, sessionVersion: this.auth.sessionVersion }); if (!metadata) throw new ServiceError(401, "invalid_token", "The owner session is no longer active."); return publicValue(createdAccessToken, JSON.parse(JSON.stringify({ ...metadata, token }))); }
  async revokeAccessToken(id: string) { await this.authorizeOwnerSession("jobs:write"); if (!await new AccessTokenRepository(databaseFor(this.env), this.auth.tenantId).revoke(id)) throw new ServiceError(404, "not_found", "Access token not found"); return { revoked: true }; }
}
