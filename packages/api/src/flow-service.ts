import { markdown, validPath } from "./skill-files";
import { PostgresSkillContentCache } from "./postgres/skill-content-cache";
import { skillTriggerInput } from "./skill-trigger";
import { skillDefaults, skillSettingsInput } from "./skill-settings";
import {runPromptPreview} from "./run-prompt";
import {createHash} from "node:crypto";
import {Buffer} from "node:buffer";
import {RunMedia} from "./run-media";
import {mediaUploadInput,fetchMediaInput,mediaType,MEDIA_LIMIT} from "./media-contracts";
import {WorkspaceVm} from "./workspace-vm";
import {vmExecInput} from "./agent-api-contracts";
import {activeHostedRunIdentity} from "./hosted-run-auth";
import {configuredPiProvider,modelProviderConfiguration,type ModelProviderConfiguration} from "./pi-provider";
import {parseSkillUri, skillEntry, skillResource,parseSnapshotSkillUri,snapshotSkillUri} from "./mcp-skills";
import { TeamRepository, INITIAL_TEAM_DEFAULTS } from "./postgres/team-repository";
import { vmPresetInput } from "./vm-presets";
import { VmPresetRepository } from "./postgres/vm-preset-repository";
import { SkillContentError } from "./skill-files";
import { SkillContent } from "./skill-content";
import { SkillLibrary } from "./skill-library";
import { configureLibrary } from "./skill-library-contract";
import { submitRun } from "./postgres/run-submission";
import type { DatabaseClient } from "./postgres/database";
import { startRunInput,projectRunDefaults,scopeSchema, teamRunDefaults } from "./flow-schemas";
import { grantVm, revokeVmGrant } from "./vm-grants";
import { AgentApiService, listAgentPolicies } from "./agent-api";
import {PhoenixIntegration,runPhoenixStatus} from "./phoenix";
import {phoenixInput,phoenixRevision} from "./phoenix-contracts";
import {RunTelemetry,telemetryPageQuery,telemetryContentQuery} from "./run-telemetry";
import {pricingOverrideInput,pricingCatalogVersion,pricingCatalogSource} from "./model-pricing";
import {ProxyPayloads,createPayloadInput,appendPayloadInput,finalizePayloadInput,attachmentInput} from "./proxy-payloads";
import {ProxyOperations,operationRef,operationRead} from "./proxy-operations";
import {queryApiResponseInput} from "./agent-api-contracts";
import { apiPolicyInput, integrationRef, requestApiInput, readApiResponseInput } from "./agent-api-contracts";
import { DEFAULT_RUN_SCOPES } from "./run-scopes";
import { launchPayloadResponse } from "./launch-payload";
import { searchResponse } from "./search-contracts";
import { integrationStatus, exeConnection, accessToken, createdAccessToken, clientPermissionsInput, clientNameInput, authorizedClient } from "./settings-contracts";
import { namedOption, providerOptions, githubRepository, githubInstallation, tailIntegration } from "./editor-contracts";
import { z } from "zod";
import { runPageResponse, fullRunResponse, runtimeContextResponse, runtimeIntegrationsResponse } from "./run-read-contracts";
import { eventContextCatalog } from "./trigger-context";
import type { Env, OAuthProps } from "./types";
import { canonicalizeVmImage, renameRunSchema, reportRunErrorSchema, vmImageVerificationInput, type TriggerInput, type ManualInvocationInput } from "./flow-schemas";
import { nextOccurrence, validateScheduleConfig } from "./schedule";
import { databaseFor } from "./postgres/database";
import { IdentityRepository } from "./postgres/identity-repository";
import { AccessTokenRepository } from "./postgres/access-token-repository";
import { InvalidTriggerSummaryCursor, TriggerSummaryRepository } from "./postgres/job-summary-repository";
import { triggerResponse } from "./job-contracts";
import type { TriggerPageQuery } from "./job-contracts";
import { PostgresTriggerRepository, StaleTriggerEdit, ContextReviewRequired } from "./postgres/job-repository";
import { ConnectionRepository } from "./postgres/connection-repository";
import { CredentialRepository, IntegrationIdempotencyConflictError, IntegrationValidationError, StaleIntegrationRevisionError } from "./postgres/credential-repository";
import { XConnectionRepository } from "./postgres/x-connection-repository";
import { createXPKCE, signXOAuthState, validateXOAuthScopes, type XOAuthScope } from "./x-oauth";
import { decrypt, encrypt } from "./crypto";
import { InvocationService, composeTriggerContext, renderRunName, type Trigger, type Event } from "./job-domain";
import { RunQueryRepository } from "./postgres/run-query-repository";
import { TraceRepository } from "./postgres/trace-repository";
import { GitHubRepository } from "./postgres/github-repository";
import { IntegrationService } from "./postgres/integration-service";
import { OperationsRepository } from "./postgres/operations-repository";
import { installedEventAvailability } from "./trigger-availability";
import { evaluateWebhookConditions } from "./webhook-conditions";
import { triggerConditionsTestSchema, invocationPermissionsResponse } from "./flow-schemas";
import { ProviderCatalog } from "./postgres/provider-catalog";
import { ArtifactRepository } from "./postgres/artifact-repository";
import { ACCESS_SCOPES, accessTokenDigest, issueAccessToken, normalizeScopes } from "./access-tokens";

import { TraceProjectionRepository } from "./postgres/trace-projection-repository";
import { replayTrace, traceReplaySchema, traceReplayRunIdSchema, TraceReplayError } from "./trace-replay";
import { effortOptions, selectableExeTags, type ExeConnection } from "./exe";
import { ExeImageVerificationError, ExeVmBackend } from "./exe-vm-backend";
import { SkillRepository, SkillConflict, SkillReferenced } from "./postgres/skill-repository";
import { RunRepository } from "./postgres/run-repository";
import { safeDiagnosticText } from "./harness-diagnostics";
import { skillInput, skillUpdateInput, skillPage, skillResponse, skillTriggersResponse, previewSkillInput, composePrompt } from "./skills";
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

type Scope = "runs:start" | "team:read" | "team:write" | "triggers:read" | "triggers:write" | "runs:read" | "runs:invoke" | "runs:cancel" | "runs:write" | "integrations:read" | "integrations:write" | "skills:read" | "skills:write";

export class ApiService {
  authorizationDuration = 0;
  constructor(private env: Env, private auth: OAuthProps, private ctx?: ExecutionContext, private flyMetadata: FlyExecutionMetadataLoader = getFlyExecutionMetadata) {}

  private triggers() { return new PostgresTriggerRepository(databaseFor(this.env), this.auth.tenantId, value => encrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY), value => decrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY), new SkillContent(this.env.SKILL_ARTIFACTS,new PostgresSkillContentCache(databaseFor(this.env),this.auth.tenantId,this.env.CREDENTIAL_ENCRYPTION_KEY))); }
  private connections() { return new ConnectionRepository(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY); }
  private flyConnections() { return new FlyConnectionRepository(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY); }
  private skills() { return new SkillRepository(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY, undefined, new SkillContent(this.env.SKILL_ARTIFACTS,new PostgresSkillContentCache(databaseFor(this.env),this.auth.tenantId,this.env.CREDENTIAL_ENCRYPTION_KEY))); }
  private async executionConfig(id: string) {
    // Target IDs created by the migration are deterministic md5-derived UUIDs,
    // so they do not necessarily have RFC 4122 version/variant bits. Any
    // UUID-shaped value is still safe to use in the UUID query; non-UUID values
    // are the legacy connection IDs.
    if (id === "docker") {
      if (this.env.TEST_DOCKER_EXECUTION?.enabled !== true) throw new ServiceError(400, "invalid_request", "execution integration not found");
      return { targetId: id, connectionId: id, workspace: "", cwd: "", agentKind: "code", tags: [], image: this.env.TEST_DOCKER_EXECUTION.image, executionProvider: "docker" as const };
    }
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

  private async workspaceConfiguration(id:string|undefined, requiresVm:boolean, executionType:"agent"|"code", tags:string[]=[]) {
    if(!requiresVm)return {connectionId:"",workspace:"",cwd:"",agentKind:"pi",tags:[],requiresVm:false};
    if(!id)throw new ServiceError(409,"run_defaults_required","A required VM needs an explicit configuration or Team default.");
    if(id.startsWith("amp:"))throw new ServiceError(400,"invalid_request","Select an exe.dev or Fly VM configuration.");
    if(id!=="docker")await this.validateExecutionOptions(id,"","",tags);
    const config=await this.executionConfig(id);
    return {...config,agentKind:executionType==="code"?"code":"pi",requiresVm:true};
  }

  private async portableSelections(
    config: {connectionId:string;executionProvider?:string},
    executionType: "agent" | "code",
    input: Pick<
      TriggerInput,
      | "portableIntegrationIds"
      | "githubInstallationIds"
      | "linearConnectionId"
      | "xConnectionIds"
      | "modelAccountId"
    >,
    current?: Trigger,
  ) {
    if (config.executionProvider === "docker" && executionType !== "code")
      throw new ServiceError(400, "invalid_request", "Docker test execution supports code triggers only.");
    const portableIntegrationIds =
      input.portableIntegrationIds ??
      current?.portableIntegrationIds ??
      current?.executionConfig.portableIntegrationIds ??
      [];
    const githubInstallationIds =
      input.githubInstallationIds ??
      current?.githubInstallationIds ??
      current?.executionConfig.githubInstallationIds ??
      [];
    const linearConnectionId =
      input.linearConnectionId !== undefined
        ? input.linearConnectionId
        : (current?.linearConnectionId ?? current?.executionConfig.linearConnectionId);
    const xConnectionIds =
      input.xConnectionIds ?? current?.xConnectionIds ?? current?.executionConfig.xConnectionIds ?? [];
    const modelAccountId=executionType==="code"?undefined:input.modelAccountId ?? current?.modelAccountId ?? current?.executionConfig.modelAccountId;
    const modelAccess:"native"|"portable"=executionType==="code"?"native":"portable";
    await this.validateSelectedCredentials({portableIntegrationIds,githubInstallationIds,linearConnectionId,xConnectionIds,modelAccountId});
    return {
      portableIntegrationIds,
      githubInstallationIds,
      ...(linearConnectionId ? { linearConnectionId } : {}),
      xConnectionIds,
      modelAccess,
      ...(modelAccountId ? { modelAccountId } : {}),
    };
  }

  private async validateSelectedCredentials(selection: {portableIntegrationIds?:string[];githubInstallationIds?:number[];linearConnectionId?:"linear"|null;xConnectionIds?:string[];modelAccountId?:string}) {
    const {portableIntegrationIds=[],githubInstallationIds=[],linearConnectionId,xConnectionIds=[],modelAccountId}=selection;
    const records = await new CredentialRepository(
      databaseFor(this.env),
      this.auth.tenantId,
      this.env.CREDENTIAL_ENCRYPTION_KEY,
    ).metadata();
    const byId = new Map(records.map((record) => [record.id, record]));
    if (
      new Set(portableIntegrationIds).size !== portableIntegrationIds.length ||
      portableIntegrationIds.some((id) => byId.get(id)?.kind !== "bearer")
    )
      throw new ServiceError(
        400,
        "invalid_request",
        "One or more selected portable integrations are unavailable.",
      );
    const installations = await new GitHubRepository(
      databaseFor(this.env),
      this.auth.tenantId,
    ).installations();
    const activeInstallationIds = new Set(
      installations.filter((item) => item.state === "active").map((item) => Number(item.installationId)),
    );
    if (
      new Set(githubInstallationIds).size !== githubInstallationIds.length ||
      githubInstallationIds.some((id) => !activeInstallationIds.has(id))
    )
      throw new ServiceError(
        400,
        "invalid_request",
        "One or more selected GitHub installations are unavailable.",
      );
    if (linearConnectionId && !(await this.connections().get("linear")))
      throw new ServiceError(400, "invalid_request", "The selected Linear connection is unavailable.");
    const xConnections = await new XConnectionRepository(
      databaseFor(this.env),
      this.auth.tenantId,
      this.env.CREDENTIAL_ENCRYPTION_KEY,
    ).list();
    if (
      new Set(xConnectionIds).size !== xConnectionIds.length ||
      xConnectionIds.some(
        (id) => !xConnections.some((connection) => connection.id === id && connection.status === "connected"),
      )
    )
      throw new ServiceError(
        400,
        "invalid_request",
        "One or more selected X connections are unavailable. Connect them or remove the selections.",
      );
    if (modelAccountId && byId.get(modelAccountId)?.kind !== "model")
      throw new ServiceError(400, "invalid_request", "The selected model account is unavailable.");
    if (
      modelAccountId &&
      !configuredPiProvider((await this.credentials().managedCredential(modelAccountId,"model"))?.payload ?? "")
    )
      throw new ServiceError(
        400,
        "invalid_request",
        "Connect the selected model account before using it in a trigger.",
      );
    for (const id of portableIntegrationIds)
      if (!(await this.credentials().managedCredential(id, "bearer")))
        throw new ServiceError(
          400,
          "invalid_request",
          "Re-enter the selected bearer credential before using it in a trigger.",
        );
  }

  private async validateExecutionOptions(id: string, model: string, effort: string, tags: string[], modelProvider?: keyof typeof effortOptions) {
    if (id === "docker") throw new ServiceError(400, "invalid_request", "Docker test execution supports code triggers only.");
    if (id.startsWith("amp:")) return;
    const connection = await this.connections().get<ExeConnection>(`exe:${id}`);
    if (!connection) {
      if (await this.flyExecutionConfigs().get(id)) return;
      throw new ServiceError(400, "invalid_request", "execution integration not found");
    }
    const availableTags = new Set(selectableExeTags(connection));
    if (tags.some(tag => !availableTags.has(tag))) throw new ServiceError(400, "invalid_request", "VM tags must be selected from the available exe.dev labels.");
  }

  private normalizedEvents(input: TriggerInput["events"], existing: Event[] = []): Event[] {
    const source = input.some(event => event.kind === "manual") ? input : [{ kind: "manual" as const, enabled: true, config: {} }, ...input];
    const prior = new Map(existing.map(event => [event.id, event])), used = new Set(existing.map(event => event.slug));
    let next = 1, timestamp = new Date().toISOString();
    return source.map(event => {
      // A event's kind is part of its identity. Changing kind is a removal
      // plus an insertion, never an in-place mutation of historical identity.
      const candidate = event.id ? prior.get(event.id) : undefined;
      const old = candidate?.kind === event.kind ? candidate : undefined;
      while (used.has(`event-${next}`)) next++;
      const slug = old?.slug ?? event.slug ?? `event-${next++}`; used.add(slug);
      return { id: old?.id ?? crypto.randomUUID(), triggerId: old?.triggerId ?? "", kind: event.kind, slug, enabled: event.enabled !== false, config: event.config, template:event.template, createdAt: old?.createdAt ?? timestamp, updatedAt: timestamp };
    });
  }
  private async skillSelections(ids: string[]) {
    if (new Set(ids).size !== ids.length) throw new ServiceError(400, "invalid_request", "A skill may only be selected once per trigger.");
    const repository = this.skills();
    const values = await Promise.all(ids.map(id => repository.get(id)));
    if (values.some(value => !value)) throw new ServiceError(400, "invalid_request", "One or more selected skills are unavailable.");
    return values.map((value, position) => ({ id: value!.id, key: value!.key, revision: value!.revision, body: value!.body ?? "", position }));
  }

  private async triggerStatistics(ids: string[]) {
    if (!ids.length) return new Map<string, { running_count: string; last_run_state: string | null }>();
    const result = await databaseFor(this.env).pool.query<{ trigger_id: string; running_count: string; last_run_state: string | null }>(`
      SELECT selected.trigger_id,active.running_count,latest.state last_run_state
      FROM unnest($2::uuid[]) selected(trigger_id)
      CROSS JOIN LATERAL (
        SELECT count(*)::text running_count FROM app.trigger_runs r
        WHERE r.tenant_id=$1 AND r.trigger_id=selected.trigger_id
          AND r.state IN ('reserved','starting','running','blocked','stopping')
      ) active
      LEFT JOIN LATERAL (
        SELECT r.state FROM app.trigger_runs r
        WHERE r.tenant_id=$1 AND r.trigger_id=selected.trigger_id
        ORDER BY r.created_at DESC,r.id DESC LIMIT 1
      ) latest ON true`, [this.auth.tenantId, ids]);
    return new Map(result.rows.map(row => [row.trigger_id, row]));
  }

  private async presentTrigger(trigger: Trigger, loadedStats?: { running_count: string; last_run_state: string | null }) {
    const stats = loadedStats ?? (await this.triggerStatistics([trigger.id])).get(trigger.id);
    const runningCount = Number(stats?.running_count ?? 0);
    return publicValue(triggerResponse, {
      ...trigger,
      skillId: trigger.skill?.id ?? trigger.executionConfig.skillId ?? null,
      runScopes: trigger.runScopes ?? [...DEFAULT_RUN_SCOPES],
      executionType: trigger.executionType ?? "agent",
      requiresVm: trigger.executionConfig.requiresVm ?? (trigger.executionType==="code" || Boolean(trigger.executionConfig.connectionId)),
      skill:trigger.skill ? {id:trigger.skill.id,key:trigger.skill.key,revision:trigger.skill.revision} : null,
      events: trigger.events.map((event) => ({
        ...event,
        config:
          event.kind === "webhook"
            ? {
                ...event.config,
                ...(event.config.signingSecret || event.config.secret ? { secretConfigured: true } : {}),
                ...(event.config.provider === "cloudflareTail"
                  ? {
                      destination: `${this.env.APP_ORIGIN}/webhooks/cloudflare/${encodeURIComponent(this.auth.tenantId)}/${encodeURIComponent(trigger.id)}`,
                    }
                  : {}),
              }
            : event.config,
      })),
      runNameTemplate: trigger.runNameTemplate ?? "",
      executionConfigId:
        trigger.executionConfig.targetId ??
        `${trigger.executionConfig.agentKind === "Amp" ? "amp:" : ""}${trigger.executionConfig.connectionId}`,
      agentKind: trigger.executionConfig.agentKind,
      runningCount,
      currentRuns: runningCount,
      maxConcurrency: trigger.concurrencyLimit,
      lastRunState: stats?.last_run_state ?? null,
    });
  }
  private library() { return new SkillLibrary(this.env,this.auth.tenantId); }
  async skillLibraryStatus() { await this.authorize("skills:read"); return this.library().status(); }
  async configureSkillLibrary(input: unknown) {
    await this.authorize("skills:write");
    const parsed = configureLibrary.parse(input);
    if (parsed.kind === "github") await this.authorize("integrations:write");
    try {
      if (parsed.kind === "managed") return await this.library().configure(parsed);
      const { confirmOverwrite, ...source } = parsed;
      return await this.library().configure(source, confirmOverwrite);
    }
    catch (e) { if (e instanceof SkillConflict) throw new ServiceError(409,"skill_conflict",e.message); throw e; }
  }
  async skillLibraryToken() {
    await this.authorize("skills:write");
    try { return await this.library().token(); }
    catch (e) { if (e instanceof SkillConflict) throw new ServiceError(409,"skill_conflict",e.message); throw e; }
  }
  async syncSkillLibrary() { await this.authorize("skills:write"); const library=this.library(); await library.sync(); return library.status(); }
  async listSkills(query: { q: string; limit: number; cursor?: string }) { await this.authorize("skills:read"); return publicValue(skillPage, await this.skills().list(query.q, query.limit, query.cursor)); }
  private async pinnedSkills() {
    if(!this.auth.runId)return [];
    const row=(await databaseFor(this.env).pool.query(`SELECT j.encrypted_skill_snapshot FROM app.trigger_runs j JOIN app.runs r ON r.tenant_id=j.tenant_id AND r.id=j.id
      WHERE j.tenant_id=$1 AND j.id=$2 AND j.state IN ('starting','running','blocked') AND r.state IN ('starting','running','blocked')`,[this.auth.tenantId,this.auth.runId])).rows[0];
    if(!row)throw new ServiceError(401,"invalid_token","The run is no longer active.");
    return row.encrypted_skill_snapshot?JSON.parse(await decrypt(row.encrypted_skill_snapshot,this.env.CREDENTIAL_ENCRYPTION_KEY)) as {id:string;key:string;body:string;version?:import("./skill-files").SkillVersion}[]:[];
  }
  async mcpListSkills(cursor?:string) {
    await this.authorizeIdentity();const pinned=await this.pinnedSkills();
    const skills=cursor?[]:await Promise.all(pinned.map(skill=>skillEntry(this.auth.tenantId,skill,path=>snapshotSkillUri(this.auth.tenantId,this.auth.runId!,skill.key,path))));
    if(!this.auth.scopes.includes("skills:read")){
      if(!this.auth.runId)await this.authorize("skills:read");
      return {resultType:"complete" as const,skills,ttlMs:0,cacheScope:"private" as const};
    }
    await this.authorize("skills:read");const store=this.skills(),page=await store.list("",30,cursor);
    for(const item of page.items){if(pinned.some(skill=>skill.id===item.id))continue;const skill=await store.get(item.id);if(skill)skills.push(await skillEntry(this.auth.tenantId,skill));}
    return {resultType:"complete" as const,skills,...(page.nextCursor?{nextCursor:page.nextCursor}:{}),ttlMs:0,cacheScope:"private" as const};
  }
  async mcpGetSkill(uri:string) {
    await this.authorizeIdentity();
    if(uri.startsWith("skill://runs/")){
      if(!this.auth.runId)throw new SkillContentError("Unknown skill resource.");
      const {name,path}=parseSnapshotSkillUri(uri,this.auth.tenantId,this.auth.runId);
      const skill=(await this.pinnedSkills()).find(skill=>skill.key===name);
      if(!skill||path!=="SKILL.md")throw new SkillContentError("Unknown skill resource.");
      return {resultType:"complete" as const,skill:await skillEntry(this.auth.tenantId,skill,path=>snapshotSkillUri(this.auth.tenantId,this.auth.runId!,skill.key,path)),ttlMs:0,cacheScope:"private" as const};
    }
    await this.authorize("skills:read");
    const {name,path}=parseSkillUri(uri,this.auth.tenantId);
    if(path!=="SKILL.md")throw new SkillContentError("Unknown skill resource.");
    const skill=await this.skills().get(name);if(!skill)throw new SkillContentError("Unknown skill resource.");
    return {resultType:"complete" as const,skill:await skillEntry(this.auth.tenantId,skill),ttlMs:0,cacheScope:"private" as const};
  }
  async mcpReadSkill(uri:string) {
    await this.authorizeIdentity();
    if(uri.startsWith("skill://runs/")){
      if(!this.auth.runId)throw new SkillContentError("Unknown skill resource.");
      const {name,path}=parseSnapshotSkillUri(uri,this.auth.tenantId,this.auth.runId);
      const skill=(await this.pinnedSkills()).find(skill=>skill.key===name);if(!skill)throw new SkillContentError("Unknown skill resource.");
      return {contents:[skillResource(this.auth.tenantId,skill,path,path=>snapshotSkillUri(this.auth.tenantId,this.auth.runId!,skill.key,path))],ttlMs:0,cacheScope:"private" as const};
    }
    await this.authorize("skills:read");const {name,path}=parseSkillUri(uri,this.auth.tenantId),skill=await this.skills().get(name);
    if(!skill)throw new SkillContentError("Unknown skill resource.");
    return {contents:[skillResource(this.auth.tenantId,skill,path)],ttlMs:0,cacheScope:"private" as const};
  }
  async getSkill(id: string) { await this.authorize("skills:read"); const value = await this.skills().get(id); if (!value) throw new ServiceError(404, "not_found", "Skill not found"); return publicValue(skillResponse, value); }
  async getSkillDirectory(id:string){
    await this.authorize("skills:read");const skill=await this.skills().get(id);
    if(!skill)throw new ServiceError(404,"not_found","Skill not found");
    const files=skill.version?.files??[markdown(skill.body??"")];
    if(files.some(file=>!validPath(file.path)))throw new ServiceError(409,"invalid_skill","Skill contains an invalid file path.");
    return {revision:skill.revision,commit:skill.version?.commit??null,files};
  }
  async getSkillSettings(id: string) { await this.authorize("skills:read"); return this.readSkillSettings(id); }
  private async readSkillSettings(id:string) {
    const row=(await databaseFor(this.env).pool.query("SELECT run_defaults,encrypted_prompt,encrypted_script,settings_revision FROM app.skills WHERE tenant_id=$1 AND id=$2",[this.auth.tenantId,id])).rows[0];
    if(!row)throw new ServiceError(404,"not_found","Skill not found");
    const legacyScript=!row.encrypted_script && row.run_defaults.executionType==="code" ? (await databaseFor(this.env).pool.query("SELECT execution_config->>'script' script FROM app.triggers t JOIN app.trigger_skills ts ON ts.tenant_id=t.tenant_id AND ts.trigger_id=t.id WHERE ts.tenant_id=$1 AND ts.skill_id=$2",[this.auth.tenantId,id])).rows[0]?.script : undefined;
    return {revision:row.settings_revision,defaults:skillDefaults.parse({...row.run_defaults,prompt:row.encrypted_prompt?await decrypt(row.encrypted_prompt,this.env.CREDENTIAL_ENCRYPTION_KEY):"",...(row.encrypted_script?{script:await decrypt(row.encrypted_script,this.env.CREDENTIAL_ENCRYPTION_KEY)}:legacyScript?{script:legacyScript}:{})})};
  }
  async setSkillSettings(id:string,request:unknown) {
    await this.authorize("skills:write"); await this.authorize("triggers:write");
    const input=skillSettingsInput.parse(request), defaults=input.defaults;
    const executionType=defaults.executionType;
    if(defaults.executionConfigId && defaults.requiresVm===false)throw new ServiceError(400,"invalid_request","A VM configuration requires a VM.");
    if(defaults.allowedTriggerIds?.length){const found=await databaseFor(this.env).pool.query("SELECT id FROM app.triggers WHERE tenant_id=$1 AND id=ANY($2::uuid[])",[this.auth.tenantId,defaults.allowedTriggerIds]);if(found.rowCount!==defaults.allowedTriggerIds.length)throw new ServiceError(400,"invalid_request","Destinations must belong to this team.");}
    const config=await this.workspaceConfiguration(defaults.executionConfigId,executionType==="code"||Boolean(defaults.requiresVm),executionType,defaults.tags);
    const portable=await this.portableSelections(config,executionType,defaults);
    const {prompt,script,...stored}=defaults;
    const encryptedPrompt=await encrypt(prompt,this.env.CREDENTIAL_ENCRYPTION_KEY),encryptedScript=script?await encrypt(script,this.env.CREDENTIAL_ENCRYPTION_KEY):null;
    const projected={...config,...portable,executionType,...(script?{script}:{}),...(defaults.vmImage?{image:canonicalizeVmImage(defaults.vmImage)}:{})};
    await databaseFor(this.env).transaction(async client=>{
      const updated=await client.query("UPDATE app.skills SET run_defaults=$3,encrypted_prompt=$4,encrypted_script=$5,settings_revision=settings_revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND settings_revision=$6 RETURNING id",[this.auth.tenantId,id,stored,encryptedPrompt,encryptedScript,input.expectedRevision]);
      if(!updated.rowCount)throw new ServiceError(409,"stale_skill","Skill settings changed; reload before saving.");
      // Trigger execution columns are a projection for existing schedulers and external clients.
      await client.query(`UPDATE app.triggers t SET execution_config=$3,encrypted_prompt=$4,model=$5,effort=$6,tags=$7,run_scopes=$8,concurrency_limit=$9,updated_at=now()
        FROM app.trigger_skills ts WHERE ts.tenant_id=t.tenant_id AND ts.trigger_id=t.id AND ts.skill_id=$2 AND t.tenant_id=$1`,[this.auth.tenantId,id,projected,encryptedPrompt,executionType==="code"?"":defaults.model??"",defaults.effort??"",JSON.stringify(defaults.tags??[]),JSON.stringify(defaults.runScopes??DEFAULT_RUN_SCOPES),defaults.concurrencyLimit??1]);
      if(defaults.allowedTriggerIds!==undefined){
        const linked=(await client.query("SELECT trigger_id FROM app.trigger_skills WHERE tenant_id=$1 AND skill_id=$2",[this.auth.tenantId,id])).rows;
        for(const {trigger_id} of linked){await client.query("DELETE FROM app.manual_invocation_permissions WHERE tenant_id=$1 AND source_trigger_id=$2",[this.auth.tenantId,trigger_id]);for(const destination of defaults.allowedTriggerIds)await client.query("INSERT INTO app.manual_invocation_permissions(tenant_id,source_trigger_id,destination_trigger_id) VALUES($1,$2,$3)",[this.auth.tenantId,trigger_id,destination]);}
      }
    });
    return {revision:input.expectedRevision+1,defaults};
  }
  async createSkill(input: unknown) { await this.authorize("skills:write"); const parsed = skillInput.parse(input); try { return publicValue(skillResponse, await this.library().edit(store => store.create(parsed.key,parsed.body))); } catch (e) { if (e instanceof SkillConflict) throw new ServiceError(409,"skill_conflict",e.message); throw e; } }
  async updateSkill(id: string, input: unknown) { await this.authorize("skills:write"); try { const value = await this.library().edit(store => store.update(id, skillUpdateInput.parse(input))); if (!value) throw new ServiceError(404, "not_found", "Skill not found"); return publicValue(skillResponse, value); } catch (e) { if (e instanceof SkillConflict) throw new ServiceError(409, "stale_skill", e.message); throw e; } }
  async deleteSkill(id: string, expectedRevision: number) { await this.authorize("skills:write"); try { if (!await this.library().edit(store => store.remove(id, expectedRevision))) throw new ServiceError(404, "not_found", "Skill not found"); return { id, deleted: true }; } catch (e) { if (e instanceof SkillReferenced) throw new ServiceError(409, "skill_referenced", `${e.message} Triggers: ${e.triggers.map(trigger => trigger.name).join(", ")}`); if (e instanceof SkillConflict) throw new ServiceError(409, "stale_skill", e.message); throw e; } }
  async getSkillTrigger(id:string){
    await this.authorize("skills:read");await this.authorize("triggers:read");
    await this.readSkillSettings(id);
    const linked=await this.skills().triggers(id);
    const trigger=linked.length?await this.getTrigger(linked[0].id):null;
    return {trigger:trigger?{...trigger,name:trigger.skill?.key??trigger.name}:null};
  }
  async saveSkillTrigger(id:string,request:unknown){
    await this.authorize("skills:write");await this.authorize("triggers:write");
    const input=skillTriggerInput.parse(request),settings=await this.readSkillSettings(id),linked=await this.skills().triggers(id);
    const existing=linked.length?await this.triggers().getTrigger(linked[0].id):null;
    const fields={...settings.defaults,name:existing?.name??("trigger-"+crypto.randomUUID()),skillId:id,events:input.events,runNameTemplate:existing?.runNameTemplate??""};
    const trigger=existing?await this.updateTrigger(existing.id,{...fields,expectedUpdatedAt:input.expectedUpdatedAt}):await this.createTrigger(fields);
    if(trigger.enabled!==input.enabled)await this.setTriggerEnabled(trigger.id,input.enabled);
    return this.getSkillTrigger(id);
  }
  async listSkillTriggers(id: string) { await this.authorize("skills:read"); return publicValue(skillTriggersResponse, { skillId: id, triggers: await this.skills().triggers(id) }); }
  async previewTriggerPrompt(input: unknown) {
    await this.authorize("skills:read");
    const parsed=previewSkillInput.parse(input);
    const skill=parsed.skillId ? await this.skills().get(parsed.skillId) : null;
    if (parsed.skillId && !skill) throw new ServiceError(400,"invalid_request","The selected skill is unavailable.");
    if(parsed.eventKind!=="manual" && parsed.instructions.trim()) throw new ServiceError(400,"invalid_request","Only manual Event previews accept caller instructions.");
    const fields=parsed.eventKind==="manual" ? {...parsed.eventData,prompt:parsed.instructions} : parsed.eventData ?? {};
    const values={...fields,...(parsed.eventSlug ? {[parsed.eventSlug]:fields} : {}),...(parsed.eventKind==="webhook" ? {webhook:fields} : {})};
    const preview=composeTriggerContext(parsed.prompt,parsed.eventTemplate,values,parsed.instructions,skill ? {body:skill.body ?? ""} : undefined);
    return {...preview,skill:skill ? {id:skill.id,key:skill.key,revision:skill.revision} : null,
      runName:renderRunName(parsed.runNameTemplate ?? "",values,"Preview")};
  }


  private async authorize(scope: Scope): Promise<void> {
    if (!(this.auth.oauthGrantId ? this.auth.scopes : normalizeScopes(this.auth.scopes)).includes(scope)) throw new ServiceError(403, "insufficient_scope", `The ${scope} scope is required.`);
    await this.authorizeIdentity();
  }
  private async authorizeIdentity(): Promise<void> {
    if(this.auth.authMethod==="hosted_pi" && !await activeHostedRunIdentity(databaseFor(this.env),this.auth))throw new ServiceError(401,"invalid_token","The hosted run lease is no longer authorized.");
    const started = performance.now();
    try {
      const database = databaseFor(this.env);
      const member = await new IdentityRepository(database, this.auth.tenantId).member(this.auth.userId);
      const tokenActive = !this.auth.accessTokenId || await new AccessTokenRepository(database, this.auth.tenantId).active(this.auth.accessTokenId);
      if (member?.role !== "owner" || member.sessionVersion !== this.auth.sessionVersion || !tokenActive) throw new ServiceError(401, "invalid_token", "The request is not authorized.");
    } finally { this.authorizationDuration += performance.now() - started; }
  }
  private async authorizeOwnerSession(scope: Scope): Promise<void> { await this.authorize(scope); if (this.auth.authMethod !== "session") throw new ServiceError(403, "session_required", "An interactive owner session is required."); }

  agentApi() { return new AgentApiService(this.env, this.auth); }
  grantVm(input: unknown) { return grantVm(this.env,this.auth,input); }
  revokeVmGrant(id: string) { return revokeVmGrant(this.env,this.auth,id); }
  async getApiReflection() {
    const reflection=await this.agentApi().reflection();
    const hosted=this.auth.authMethod==="hosted_pi";
    return {...reflection,media:{frameworkVersion:"1.5.2" as const,contentTypes:["text","image"] as ("text"|"image")[],maxUploadBytes:MEDIA_LIMIT,maxTurnMediaBytes:16*1024*1024,uploadUrl:this.env.APP_ORIGIN+"/api/v1/media/uploads",fetchTool:"fetch_media" as const,readTool:"read_media" as const},agentHost:hosted?"factorize" as const:this.auth.authMethod==="vendor_identity"?"vm" as const:"external" as const,current_vm:hosted&&this.auth.runId?await new WorkspaceVm(databaseFor(this.env),this.env).current(this.auth.tenantId,this.auth.runId):null};
  }
  async vmExec(input:z.infer<typeof vmExecInput>,signal?:AbortSignal){
    await this.authorizeIdentity();
    if(this.auth.authMethod!=="hosted_pi" || !this.auth.runId)throw new ServiceError(403,"workspace_required","This identity has no server-bound workspace VM.");
    return new WorkspaceVm(databaseFor(this.env),this.env).execute(this.auth.tenantId,this.auth.runId,input.command,input.cwd,signal,()=>this.authorizeIdentity());
  }
  private async media(write=false){
    await this.authorizeIdentity();if(!this.auth.runId)await this.authorize(write?"runs:start":"runs:read");
    return new RunMedia(databaseFor(this.env),this.env,this.auth);
  }
  async createMediaUpload(input:unknown){return (await this.media(true)).create(mediaUploadInput.parse(input));}
  async uploadMedia(id:string,request:Request){return (await this.media(true)).upload(id,request);}
  async downloadMedia(id:string){const {row,object}=await (await this.media()).read(id);return new Response(object.body,{headers:{"Content-Type":row.media_type,"Content-Length":String(row.byte_size),"Content-Disposition":"attachment","Content-Security-Policy":"default-src 'none'; sandbox","Cache-Control":"private, no-store"}});}
  async readMedia(id:string){const media=await this.media();return {content:[await media.image(id)]};}
  async fetchMedia(input:unknown,signal?:AbortSignal){
    const value=fetchMediaInput.parse(input),media=await this.media(true);
    const response=await this.agentApi().request(requestApiInput.parse({integration:value.integration,path:value.path,headers:value.headers,method:"GET"}),signal);
    try{
    if(response.status<200 || response.status>=300)throw new ServiceError(502,"media_fetch_failed",`The authorized media source returned HTTP ${response.status}.`);
    const mime=mediaType.parse(response.headers["content-type"]?.split(";",1)[0].trim());
    if(response.size<1 || response.size>MEDIA_LIMIT)throw new ServiceError(413,"invalid_media","Fetched media exceeds the 32 MiB limit or is empty.");
    const inline=response.body!==undefined?new Uint8Array(response.encoding==="base64"?Buffer.from(response.body,"base64"):new TextEncoder().encode(response.body)):undefined;
    const source=()=>{
      let offset=0,done=false;
      return new ReadableStream<Uint8Array>({pull:async controller=>{
        if(signal?.aborted)throw signal.reason;
        if(inline){if(!done)controller.enqueue(inline);done=true;controller.close();return;}
        if(!response.handle)throw new ServiceError(502,"media_fetch_failed","Media response has no body.");
        const chunk=await this.agentApi().read({handle:response.handle,offset});offset=chunk.nextOffset;controller.enqueue(new Uint8Array(Buffer.from(chunk.body,"base64")));if(chunk.done)controller.close();
      }});
    };
    const hash=createHash("sha256"),reader=source().getReader();for(;;){const {value,done}=await reader.read();if(done)break;hash.update(value);}
    const receipt=await media.create({mediaType:mime,byteSize:response.size,sha256:hash.digest("hex"),idempotencyKey:value.idempotencyKey});
    if(receipt.state==="ready")return receipt;
    return await media.upload(receipt.artifactId,new Request(this.env.APP_ORIGIN,{method:"PUT",headers:{"Content-Type":mime},body:source(),signal,duplex:"half"} as RequestInit));
    }finally{if(response.handle)await databaseFor(this.env).pool.query("UPDATE app.agent_proxy_responses SET expires_at=now() WHERE tenant_id=$1 AND id=$2",[this.auth.tenantId,response.handle]);}

  }
  async getPhoenix(){await this.authorizeOwnerSession("integrations:read");return new PhoenixIntegration(this.env,this.auth.tenantId).get();}
  async putPhoenix(input:unknown){await this.authorizeOwnerSession("integrations:write");return new PhoenixIntegration(this.env,this.auth.tenantId).put(phoenixInput.parse(input));}
  async deletePhoenix(input:unknown){await this.authorizeOwnerSession("integrations:write");return new PhoenixIntegration(this.env,this.auth.tenantId).remove(phoenixRevision.parse(input).expectedRevision);}
  async testPhoenix(){await this.authorizeOwnerSession("integrations:write");return new PhoenixIntegration(this.env,this.auth.tenantId).test();}
  async getRunTelemetry(runId:string,query:unknown){await this.authorize("runs:read");const page=await new RunTelemetry(databaseFor(this.env),this.env.CREDENTIAL_ENCRYPTION_KEY,this.auth.tenantId).page(runId,telemetryPageQuery.parse(query));return {...page,phoenix:await runPhoenixStatus(this.env,this.auth.tenantId,runId)};}
  async getRunTelemetryContent(runId:string,spanId:string,query:unknown){await this.authorize("runs:read");return new RunTelemetry(databaseFor(this.env),this.env.CREDENTIAL_ENCRYPTION_KEY,this.auth.tenantId).content(runId,spanId,telemetryContentQuery.parse(query));}
  async getModelPricing(){await this.authorize("integrations:read");const rows=(await databaseFor(this.env).pool.query("SELECT integration_id,model,rates,revision FROM app.model_pricing_overrides WHERE tenant_id=$1 ORDER BY model,integration_id",[this.auth.tenantId])).rows;return {catalogVersion:pricingCatalogVersion,source:pricingCatalogSource,items:rows.map(row=>({integrationId:row.integration_id,model:row.model,rates:row.rates,revision:row.revision}))};}
  async setModelPricing(input:unknown){
    await this.authorizeOwnerSession("integrations:write");const value=pricingOverrideInput.parse(input),db=databaseFor(this.env);
    if(!(await db.pool.query("SELECT 1 FROM app.integration_records WHERE tenant_id=$1 AND id=$2 AND kind='model'",[this.auth.tenantId,value.integrationId])).rowCount)throw new ServiceError(404,"not_found","Model integration not found.");
    const row=(await db.pool.query("INSERT INTO app.model_pricing_overrides(tenant_id,integration_id,model,rates) SELECT $1,$2,$3,$4 WHERE $5=0 OR EXISTS(SELECT 1 FROM app.model_pricing_overrides WHERE tenant_id=$1 AND integration_id=$2 AND model=$3) ON CONFLICT(tenant_id,integration_id,model) DO UPDATE SET rates=excluded.rates,revision=app.model_pricing_overrides.revision+1,updated_at=now() WHERE app.model_pricing_overrides.revision=$5 RETURNING revision",[this.auth.tenantId,value.integrationId,value.model,value.rates,value.expectedRevision])).rows[0];
    if(!row)throw new ServiceError(409,"revision_conflict","Pricing changed; reload before saving.");return {integrationId:value.integrationId,model:value.model,rates:value.rates,revision:row.revision};
  }
  async createProxyPayload(input:unknown){return new ProxyPayloads(this.env,this.auth).create(createPayloadInput.parse(input));}
  async getProxyPayload(id:string){return new ProxyPayloads(this.env,this.auth).get(id);}
  async uploadProxyPayload(id:string,request:Request){return new ProxyPayloads(this.env,this.auth).upload(id,request);}
  async appendProxyPayload(input:unknown){return new ProxyPayloads(this.env,this.auth).append(appendPayloadInput.parse(input));}
  async finalizeProxyPayload(input:unknown){return new ProxyPayloads(this.env,this.auth).finalize(finalizePayloadInput.parse(input));}
  async importProxyAttachment(input:unknown){return new ProxyPayloads(this.env,this.auth).importAttachment(attachmentInput.parse(input));}
  async fetchProxyPayload(input:{integration:string;path:string;name?:string;mediaType?:string}){return new ProxyPayloads(this.env,this.auth).importIntegration(input);}
  async requestApiMcp(input:unknown,signal?:AbortSignal){
    const parsed=requestApiInput.parse(input);
    return parsed.execution==="async" || parsed.execution!=="sync" && this.auth.authMethod==="oauth" ? this.startApiOperation(parsed) : this.requestApi(parsed,signal);
  }
  async startApiOperation(input:unknown){return new ProxyOperations(this.env,this.auth).start(requestApiInput.parse(input));}
  async getApiOperation(input:unknown){return new ProxyOperations(this.env,this.auth).get(operationRef.parse(input).operationId);}
  async cancelApiOperation(input:unknown){return new ProxyOperations(this.env,this.auth).cancel(operationRef.parse(input).operationId);}
  async readApiOperation(input:unknown){return new ProxyOperations(this.env,this.auth).read(operationRead.parse(input));}
  async requestApi(input: unknown, signal?: AbortSignal) { return this.agentApi().request(requestApiInput.parse(input), signal); }
  async queryApiResponse(input:unknown){return this.agentApi().query(queryApiResponseInput.parse(input));}
  async readApiResponse(input: unknown) { return this.agentApi().read(readApiResponseInput.parse(input)); }
  async listApiPolicies() { await this.authorizeOwnerSession("integrations:read"); return listAgentPolicies(this.env, this.auth.tenantId); }
  async updateApiPolicy(id: string, input: unknown) {
    await this.authorizeOwnerSession("integrations:write");
    integrationRef.parse(id); const parsed = apiPolicyInput.parse(input);
    const updated = await databaseFor(this.env).pool.query("UPDATE app.agent_integrations SET policy=$3 WHERE tenant_id=$1 AND id=$2 AND revision=$4 RETURNING id", [this.auth.tenantId,id,parsed.policy,parsed.expectedRevision]);
    if (!updated.rowCount) throw new ServiceError(409,"stale_policy","Integration policy changed or is unavailable. Reload before updating.");
    return this.listApiPolicies();
  }

  async getRuntimeIntegrations() {
    await this.authorizeIdentity();
    if (this.auth.authMethod !== "vendor_identity" || !this.auth.runId) throw new ServiceError(403, "forbidden", "A vendor-verified run identity is required.");
    const db = databaseFor(this.env), tenantId = this.auth.tenantId, runId = this.auth.runId;
    const active = (await db.pool.query<{execution_config: Record<string, any>}>(`SELECT r.execution_config FROM app.runs r JOIN app.trigger_runs j ON j.tenant_id=r.tenant_id AND j.id=r.id
      WHERE r.tenant_id=$1 AND r.id=$2 AND r.state IN ('starting','running','blocked') AND j.state IN ('starting','running','blocked')`, [tenantId, runId])).rows[0];
    if (!active) throw new ServiceError(403, "forbidden", "The run is no longer active.");
    const config = active.execution_config;
    const ids = Array.isArray(config.portableIntegrationIds) ? config.portableIntegrationIds : [];
    const githubIds = Array.isArray(config.githubInstallationIds) ? config.githubInstallationIds : [];
    const xIds = Array.isArray(config.xConnectionIds) ? config.xConnectionIds : [];
    const [records, installations, revoked, linear, model, xConnections] = await Promise.all([
      db.pool.query<{id: string; name: string; description: string | null}>("SELECT id,name,description FROM app.integration_records WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND kind='bearer' AND deleted_at IS NULL", [tenantId, ids]),
      db.pool.query<{installation_id: number; state: string}>("SELECT installation_id,state FROM app.github_installations WHERE tenant_id=$1 AND installation_id=ANY($2::bigint[])", [tenantId, githubIds]),
      db.pool.query<{kind: string; credential_id: string}>("SELECT kind,credential_id FROM app.run_credential_revocations WHERE tenant_id=$1 AND run_id=$2", [tenantId, runId]),
      config.linearConnectionId === "linear" ? db.pool.query("SELECT 1 FROM app.connections WHERE tenant_id=$1 AND kind='linear'", [tenantId]) : null,
      config.modelAccess === "portable" && typeof config.modelAccountId === "string" ? db.pool.query("SELECT 1 FROM app.integration_records WHERE tenant_id=$1 AND id=$2 AND kind='model' AND deleted_at IS NULL", [tenantId, config.modelAccountId]) : null,
      db.pool.query<{id: string; name: string; account_handle: string | null; granted_scopes: string[]; status: string}>("SELECT id,name,account_handle,granted_scopes,status FROM app.x_connections WHERE tenant_id=$1 AND id=ANY($2::uuid[])", [tenantId, xIds]),
    ]);
    const denied = new Set(revoked.rows.map(row => `${row.kind}:${row.credential_id}`));
    return publicValue(runtimeIntegrationsResponse, {
      kind: "factorize-run-integrations-v1",
      integrations: ids.map((id: string) => { const record = records.rows.find(row => row.id === id); return {id, name: record?.name ?? "Unavailable integration", description: record?.description ?? null, path: `/integrations/${id}/`, available: Boolean(record) && !denied.has(`bearer:${id}`)}; }),
      xConnections: xIds.map((id: string) => { const connection = xConnections.rows.find(row => row.id === id); return { id, name: connection?.name ?? "Unavailable X connection", accountHandle: connection?.account_handle ?? null, scopes: connection?.granted_scopes ?? [], path: `/x/${id}/`, available: connection?.status === "connected" && !denied.has(`x:${id}`) }; }),
      providers: {
        githubInstallations: githubIds.map((installationId: number) => ({installationId, path: `/providers/github/${installationId}/`, available: installations.rows.some(row => Number(row.installation_id) === installationId && row.state === "active") && !denied.has(`github:${installationId}`)})),
        linear: config.linearConnectionId === "linear" ? {path: "/providers/linear/", available: Boolean(linear?.rowCount) && !denied.has("linear:linear")} : null,
        model: config.modelAccess === "portable" && typeof config.modelAccountId === "string" ? {path: "/providers/model/v1", available: Boolean(model?.rowCount) && !denied.has(`model:${config.modelAccountId}`)} : null,
      },
    });
  }

  async getRuntimeContext() {
    await this.authorizeIdentity();
    return publicValue(runtimeContextResponse, { kind: "factorize-runtime-context-v1", authMethod: this.auth.authMethod ?? "oauth", runId: this.auth.runId ?? null, triggerId: this.auth.runTriggerId ?? null, scopes: this.auth.oauthGrantId ? this.auth.scopes : normalizeScopes(this.auth.scopes) });
  }

  async getRuntimeLaunchPayload() {
    await this.authorizeIdentity();
    if (this.auth.authMethod !== "vendor_identity" || !this.auth.runId) throw new ServiceError(403, "forbidden", "A vendor-verified run identity is required.");
    const encrypted = await new RunRepository(databaseFor(this.env)).activeLaunchPayload(this.auth.tenantId, this.auth.runId);
    if (!encrypted) throw new ServiceError(404, "not_found", "Active launch payload unavailable.");
    const payload = publicValue(launchPayloadResponse, JSON.parse(await decrypt(encrypted, this.env.CREDENTIAL_ENCRYPTION_KEY)));
    if (payload.runId !== this.auth.runId) throw new ServiceError(500, "internal_error", "Invalid launch payload binding.");
    return payload;
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
  private vmPresets() { return new VmPresetRepository(databaseFor(this.env), this.auth.tenantId); }
  async listVmPresets() {
    await this.authorizeOwnerSession("integrations:read");
    return { presets: await this.vmPresets().list() };
  }
  async saveVmPreset(body: unknown, id?: string) {
    await this.authorizeOwnerSession("integrations:write");
    const input = vmPresetInput.parse(body);
    const settings = input.settings;
    if (settings.provider === "fly") {
      if (!await this.flyConnections().get()) throw new ServiceError(409, "fly_connection_required", "Connect Fly.io before saving this preset.");
      await this.validateFlySize(settings);
    } else {
      const status = await this.integrations().status();
      const connection = status.exeConnections.find(item => item.connectionId === settings.connectionId);
      if (!connection || settings.tags.some(tag => !connection.accountTags.includes(tag))) throw new ServiceError(400, "invalid_vm_preset", "Choose an available exe.dev connection and VM tags.");
    }
    try {
      const preset = await this.vmPresets().save(input, id);
      if (!preset) throw new ServiceError(404, "not_found", "VM preset not found.");
      return { preset };
    } catch (error) {
      if ((error as {constraint?: string}).constraint === "vm_presets_name") throw new ServiceError(409, "duplicate_name", "A VM preset already uses this name.");
      throw error;
    }
  }
  async removeVmPreset(id: string) {
    await this.authorizeOwnerSession("integrations:write");
    if (!await this.vmPresets().remove(id)) throw new ServiceError(404, "not_found", "VM preset not found.");
    return { deleted: true };
  }
  private async validateFlySize(settings: {region: string; size: string}) {
    const metadata = await this.flyMetadata();
    if (!metadata.regions.includes(settings.region) || !metadata.sizes.includes(settings.size)) throw new ServiceError(400, "invalid_fly_configuration", "The selected Fly region or VM size is unavailable.");
  }
  private flyExecutionConfigs() { return new FlyExecutionConfigurationRepository(databaseFor(this.env), this.auth.tenantId); }
  async listFlyExecutionConfigurations() { await this.authorizeOwnerSession("integrations:read"); return { configurations: await this.flyExecutionConfigs().list() }; }
  async getFlyExecutionConfiguration(id: string) { await this.authorizeOwnerSession("integrations:read"); const value = await this.flyExecutionConfigs().get(id); if (!value) throw new ServiceError(404, "not_found", "Fly execution configuration not found"); return { configuration: value }; }
  async saveFlyExecutionConfiguration(input: unknown, id?: string) {
    await this.authorizeOwnerSession("integrations:write");
    if (!await this.flyConnections().get()) throw new ServiceError(409, "fly_connection_required", "Connect a Fly account before saving execution configurations.");
    const parsed = flyExecutionConfigurationInput.parse(input);
    await this.validateFlySize(parsed);
    return { configuration: await this.flyExecutionConfigs().save(parsed, id) };
  }
  async removeFlyExecutionConfiguration(id: string) { await this.authorizeOwnerSession("integrations:write"); const deleted = await this.flyExecutionConfigs().remove(id); if (!deleted) throw new ServiceError(404, "not_found", "Fly execution configuration not found"); return { id, deleted: true }; }
  private throwFlyAccountError(error: unknown): never {
    if (error instanceof FlyAccountError) throw new ServiceError(error.kind === "auth" ? 401 : error.kind === "organization" ? 400 : 502, error.kind === "auth" ? "fly_auth_failed" : error.kind === "organization" ? "fly_organization_unavailable" : "fly_validation_failed", error.message);
    throw error;
  }
  async listGitHubInstallations() { await this.authorize("integrations:read"); return publicValue(z.array(githubInstallation), JSON.parse(JSON.stringify(await new GitHubRepository(databaseFor(this.env), this.auth.tenantId).installations()))); }
  async listTailIntegrations() { await this.authorize("integrations:read"); return publicValue(z.array(tailIntegration), await new IntegrationService(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY).tails()); }
  async listRuns(query:URLSearchParams){
    await this.authorize("runs:read");const page=await new RunQueryRepository(databaseFor(this.env),this.auth.tenantId).list(query);
    const items=await Promise.all(page.items.map(async row=>{
      const text=row.legacy_script??(row.encrypted_preview?await decrypt(row.encrypted_preview,this.env.CREDENTIAL_ENCRYPTION_KEY):"");
      return {...row,prompt_preview:runPromptPreview(text)};
    }));
    return publicValue(runPageResponse,JSON.parse(JSON.stringify({...page,items})));
  }
  async search(query: string) { await this.authorize("triggers:read"); await this.authorize("runs:read"); return publicValue(searchResponse, await new OperationsRepository(databaseFor(this.env), this.auth.tenantId).search(query)); }
  async eventContextMetadata() { await this.authorize("triggers:read"); return eventContextCatalog; }
  async getRunStatus(runId: string) { await this.authorize("runs:read"); const status = await new RunQueryRepository(databaseFor(this.env), this.auth.tenantId).status(runId); if (!status) throw new ServiceError(404, "not_found", "Run not found"); return status; }
  async reportRunError(runId: string, input: unknown) {
    await this.authorize("runs:write");
    const parsed = reportRunErrorSchema.parse(input), reason = safeDiagnosticText(parsed.reason, 1000);
    if (!reason.trim()) throw new ServiceError(400, "invalid_request", "Reason must contain safe text.");
    const reporterKind = this.auth.authMethod === "oauth" ? "oauth" : this.auth.authMethod === "access_token" ? "api_key" : ["vendor_identity","hosted_pi"].includes(this.auth.authMethod ?? "") ? "run_token" : "session";
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
    delete run.encrypted_prompt;
    run.prompt = prompt;
    run.capabilities = run.execution_capabilities;
    run.backend_kind = run.execution_backend_kind;
    run.invocation = {
      id: run.invocation_id,
      source: run.invocation_source,
      claim_key: run.invocation_claim_key,
      event_id: run.invocation_event_id,
      template_trigger_id: run.template_trigger_id,
      context: run.context,
      occurrence: run.occurrence,
      source_trigger_id: run.invocation_source_trigger_id ?? null,
      source_run_id: run.invocation_source_run_id ?? null,
      created_at: run.invocation_created_at,
    };
    const [activity, projection, cursor, artifacts] = await Promise.all([
      repository.activity(runId),
      databaseFor(this.env).pool.query(
        "SELECT source_kind,artifact_sha256,parser_version,updated_at FROM app.run_trace_projections WHERE tenant_id=$1 AND run_id=$2",
        [this.auth.tenantId, runId],
      ),
      databaseFor(this.env).pool.query(
        "SELECT generation FROM app.run_trace_cursors WHERE tenant_id=$1 AND run_id=$2",
        [this.auth.tenantId, runId],
      ),
      new ArtifactRepository(databaseFor(this.env), this.auth.tenantId).list(runId),
    ]);
    run.activity = activity;
    run.execution_diagnostics ??= null;
    run.trace_sources ??= null;
    run.trace_projection = projection.rows[0] ?? null;
    run.trace_generation = cursor.rows[0]?.generation ?? null;
    run.harness_log = artifacts.find((item) => item.kind === "terminal_log") ?? null;
    // Enumerate public fields rather than publishing future database columns.
    const agentError = run.agent_error_reason
      ? {
          reason: run.agent_error_reason,
          reported_at: run.agent_error_reported_at,
          reporter: {
            user_id: run.agent_error_reporter_user_id,
            kind: run.agent_error_reporter_kind,
            id: run.agent_error_reporter_id,
          },
        }
      : null;
    return publicValue(
      fullRunResponse,
      JSON.parse(
        JSON.stringify({
          id: run.id,
          tenant_id: run.tenant_id,
          trigger_id: run.trigger_id,
          launch_skill_id: run.launch_skill_id,
          launch_skill_key: run.launch_skill_key,
          launch_skill_revision: run.launch_skill_revision,
          invocation_id: run.invocation_id,
          execution_handle: run.execution_handle
            ? { backendKind: run.execution_handle.backendKind, id: run.execution_handle.id }
            : null,
          provider: run.provider,
          issue_id: run.issue_id,
          issue_url: run.issue_url,
          issue_title: run.issue_title,
          run_name: run.run_name,
          agent_name: run.agent_name,
          workspace_name: run.workspace_name,
          agent_kind: run.agent_kind,
          execution_type: run.execution_type ?? run.execution_config?.executionType ?? "agent",
          state: run.state,
          failure_source: run.failure_source ?? null,
          failure:
            run.failure_code && run.failure_reason
              ? {
                  source: run.failure_source === "agent" ? "run" : "system",
                  code: run.failure_code,
                  reason: run.failure_reason,
                }
              : null,
          agent_error: agentError,
          execution_backend_kind: run.execution_backend_kind,
          backend_kind: run.backend_kind,
          execution_capabilities: run.execution_capabilities,
          capabilities: run.capabilities,
          destination_url: run.destination_url,
          artifact_state: run.artifact_state,
          artifact_error: run.artifact_error,
          claim_released: run.claim_released,
          vm_cleanup_attempt: run.vm_cleanup_attempt,
          cleanup_next_at: run.cleanup_next_at,
          vm_cleanup_complete: run.vm_cleanup_complete,
          execution_script:
            typeof run.execution_config?.script === "string" ? run.execution_config.script : null,
          execution_configuration: run.execution_config,
          created_at: run.created_at,
          updated_at: run.updated_at,
          started_at: run.started_at,
          trigger_name: run.trigger_name,
          source:run.source,
          prompt_preview:runPromptPreview(run.execution_config?.script??(run.encrypted_prompt_preview?await decrypt(run.encrypted_prompt_preview,this.env.CREDENTIAL_ENCRYPTION_KEY):run.prompt)),
          context_prompt:run.encrypted_context_prompt?await decrypt(run.encrypted_context_prompt,this.env.CREDENTIAL_ENCRYPTION_KEY):run.prompt,
          prompt: run.prompt,
          context: run.context,
          occurrence: run.occurrence,
          invocation: run.invocation,
          invocation_source: run.invocation_source,
          invocation_claim_key: run.invocation_claim_key,
          invocation_event_id: run.invocation_event_id,
          invocation_created_at: run.invocation_created_at,
          activity: run.activity,
          execution_diagnostics: run.execution_diagnostics,
          trace_sources: run.trace_sources,
          trace_projection: run.trace_projection,
          trace_generation: run.trace_generation,
          harness_log: run.harness_log,
          trigger_result: run.trigger_result ?? null,
          run_artifacts: artifacts
            .filter((item) => !["execution_stream", "native_session"].includes(item.kind))
            .map((item) => ({
              id: item.id,
              kind: item.kind,
              provider: String(item.provider ?? ""),
              format: String(item.format ?? ""),
              byte_size: Number(item.byte_size),
              sha256: String(item.sha256 ?? ""),
              state: String(item.state ?? ""),
              media_type: item.media_type ?? null,
              created_at:
                item.created_at instanceof Date
                  ? item.created_at.toISOString()
                  : String(item.created_at ?? ""),
            })),
        }),
      ),
    );
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
    return { runId: run.id, triggerId: run.trigger_id, state: run.state, failureSource: run.failure_source, failure: run.failure, agentError: run.agent_error, provider: run.provider, backendKind: run.execution_backend_kind,
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
  async retryBlockedLaunch(runId: string) {
    await this.authorizeOwnerSession("runs:cancel");
    if (!await new RunRepository(databaseFor(this.env)).retryBlockedLaunch(this.auth.tenantId, runId)) throw new ServiceError(409, "operation_failed", "Run is not waiting for a manual launch retry");
    if (this.env.SCHEDULER) await this.env.SCHEDULER.get(this.env.SCHEDULER.idFromName("global")).fetch("https://scheduler/wake", { method: "POST" });
    return { runId, retryRequested: true };
  }
  killRun(runId: string) { return this.stopRun(runId); }
  async listTriggerSummaries(input: TriggerPageQuery, selector = false) { await this.authorize("triggers:read"); try { return await new TriggerSummaryRepository(databaseFor(this.env), this.auth.tenantId).page(input, selector); } catch (error) { if (error instanceof InvalidTriggerSummaryCursor) throw new ServiceError(400, "invalid_request", error.message); throw error; } }
  async listTriggers() { await this.authorize("triggers:read"); const triggers = await this.triggers().list(), stats = await this.triggerStatistics(triggers.map(trigger => trigger.id)); return Promise.all(triggers.map(trigger => this.presentTrigger(trigger, stats.get(trigger.id) ?? { running_count: "0", last_run_state: null }))); }
  async getTrigger(triggerId: string) { await this.authorize("triggers:read"); const trigger = await this.triggers().getTrigger(triggerId); if (!trigger) throw new ServiceError(404, "not_found", "Trigger not found"); return this.presentTrigger(trigger); }
  async getTeamGraph() {
    await this.authorize("triggers:read");
    const db = databaseFor(this.env), tenantId = this.auth.tenantId;
    const triggers = await db.pool.query<any>(`SELECT j.id,COALESCE((SELECT s.key FROM app.trigger_skills ts JOIN app.skills s ON s.tenant_id=ts.tenant_id AND s.id=ts.skill_id WHERE ts.tenant_id=j.tenant_id AND ts.trigger_id=j.id),j.name) name,j.enabled,j.execution_config,j.concurrency_limit,
      (SELECT count(*)::int FROM app.trigger_runs r WHERE r.tenant_id=j.tenant_id AND r.trigger_id=j.id AND r.state IN ('reserved','starting','running','blocked','stopping')) running_count,
      COALESCE(jsonb_agg(jsonb_build_object('id',t.id,'kind',t.kind,'enabled',t.enabled,'config',CASE
        WHEN t.kind='triggerLifecycle' THEN jsonb_build_object('sourceTriggerIds',t.config->'sourceTriggerIds','sourceTriggerId',t.config->'sourceTriggerId','states',t.config->'states')
        WHEN t.kind='triggerIdle' THEN jsonb_build_object('sourceTriggerIds',t.config->'sourceTriggerIds')
        WHEN t.kind='webhook' THEN jsonb_build_object('provider',t.config->>'provider','projectId',t.config->>'projectId','listId',t.config->>'listId','repositoryId',t.config->>'repositoryId','event',t.config->>'event','integrationId',t.config->>'integrationId')
        ELSE '{}'::jsonb END) ORDER BY t.position,t.id) FILTER (WHERE t.id IS NOT NULL),'[]'::jsonb) events
      FROM app.triggers j LEFT JOIN app.events t ON t.tenant_id=j.tenant_id AND t.trigger_id=j.id AND t.removed_at IS NULL
      WHERE j.tenant_id=$1 GROUP BY j.tenant_id,j.id ORDER BY j.id`, [tenantId]);
    const ids = new Set<string>(triggers.rows.map(row => row.id));
    const nodes: any[] = triggers.rows.map(row => ({ id: row.id, type: "trigger", label: row.name, triggerKind: row.execution_config?.executionType === "code" ? "Code" : "Agent", enabled: row.enabled, runningCount: Number(row.running_count ?? 0), concurrencyLimit: row.concurrency_limit }));
    const edges: any[] = [];
    const shortLabel = (value: string) => value.length > PROJECT_GRAPH_LABEL_MAX_CHARS ? `${value.slice(0, PROJECT_GRAPH_LABEL_MAX_CHARS - 1).trimEnd()}…` : value;
    const providerLabels: Record<string, string> = { linear: "Linear", clickup: "ClickUp", github: "GitHub", cloudflareTail: "Cloudflare Tail" };
    for (const trigger of triggers.rows) for (const event of trigger.events) {
      if (event.kind === "triggerLifecycle") for (const source of event.config?.sourceTriggerIds ?? (event.config?.sourceTriggerId ? [event.config.sourceTriggerId] : [])) if (ids.has(source)) {
        const states = (event.config?.states ?? []) as string[];
        const fullLabel = states.map(state => ({ succeeded: "Succeeded", failed: "Failed", stopped: "Stopped", edited: "Edited" } as Record<string, string>)[state] ?? state).join(", ") || "Lifecycle";
        edges.push({ id: `${event.id}:${source}:${trigger.id}`, source, target: trigger.id, label: shortLabel(fullLabel), details: fullLabel, kind: "lifecycle", enabled: Boolean(trigger.enabled && event.enabled) });
      }
      if (event.kind === "triggerIdle") for (const source of event.config?.sourceTriggerIds ?? []) if (ids.has(source)) edges.push({ id: `${event.id}:${source}:${trigger.id}`, source, target: trigger.id, label: "Idle", details: "Runs when the source trigger becomes idle", kind: "idle", enabled: Boolean(trigger.enabled && event.enabled) });
      if (event.kind === "webhook") {
        const config = event.config ?? {}, provider = String(config.provider ?? "webhook").slice(0, 50), displayProvider = providerLabels[provider] ?? "Webhook";
        const resource = (provider === "linear" ? String(config.projectId ?? "Project") : provider === "clickup" ? String(config.listId ?? "List") : provider === "github" ? String(config.repositoryId ? `Repository ${config.repositoryId}` : config.event ?? "Repository") : provider === "cloudflareTail" ? "Tail" : "External source").slice(0, 120);
        const source = `webhook:${provider}:${resource}`;
        const inputEvent = String(config.event ?? "").toLowerCase();
        const label = provider === "github" && ["pull_request", "pull_request_target"].includes(inputEvent) ? "GitHub PR" : provider === "github" && inputEvent === "issues" ? "GitHub Issue" : provider === "github" && inputEvent === "push" ? "GitHub Push" : displayProvider;
        const details = [displayProvider, [config.event, config.action].filter(Boolean).join(" "), resource && !["Tail", "External source"].includes(resource) ? resource : ""].filter(Boolean).join(" · ");
        if (!nodes.some(node => node.id === source)) nodes.push({ id: source, type: "webhook", label: displayProvider, provider, resource });
        edges.push({ id: `${event.id}:${source}:${trigger.id}`, source, target: trigger.id, label: shortLabel(label), details, kind: "webhook", enabled: Boolean(trigger.enabled && event.enabled) });
      }
    }
    const grants = await db.pool.query<any>(`SELECT p.source_trigger_id,p.destination_trigger_id FROM app.manual_invocation_permissions p JOIN app.triggers s ON s.tenant_id=p.tenant_id AND s.id=p.source_trigger_id JOIN app.triggers d ON d.tenant_id=p.tenant_id AND d.id=p.destination_trigger_id WHERE p.tenant_id=$1 ORDER BY p.source_trigger_id,p.destination_trigger_id`, [tenantId]);
    for (const grant of grants.rows) edges.push({ id: `manual:${grant.source_trigger_id}:${grant.destination_trigger_id}`, source: grant.source_trigger_id, target: grant.destination_trigger_id, label: "Manual", details: "Manual invocation permission", kind: "manual", enabled: Boolean(triggers.rows.find(row => row.id === grant.source_trigger_id)?.enabled && triggers.rows.find(row => row.id === grant.destination_trigger_id)?.enabled) });
    return { nodes, edges };
  }
  async listTriggerEvents(triggerId: string, limit = 50) { await this.authorize("runs:read"); return new OperationsRepository(databaseFor(this.env), this.auth.tenantId).triggerEvents(triggerId, limit); }
  async listWebhookDeliveries(query: URLSearchParams) { await this.authorize("runs:read"); return new OperationsRepository(databaseFor(this.env), this.auth.tenantId).deliveries(query); }
  async getWebhookDelivery(deliveryId: string) { await this.authorize("runs:read"); const value = await new OperationsRepository(databaseFor(this.env), this.auth.tenantId).delivery(deliveryId); if (!value) throw new ServiceError(404,"not_found","Webhook delivery not found"); return value; }
  async testTriggerConditions(input: unknown) { await this.authorize("triggers:write"); const parsed = triggerConditionsTestSchema.parse(input); return evaluateWebhookConditions(parsed.conditions, parsed.webhook); }
  async createTrigger(request: TriggerInput) {
    await this.authorize("triggers:write");
    const team = await new TeamRepository(databaseFor(this.env), this.auth.tenantId).get();
    if (!team) throw new ServiceError(404, "not_found", "Team not found");
    const owned = request.skillId ? (await this.readSkillSettings(request.skillId).catch(error=>{if(error instanceof ServiceError && error.status===404)throw new ServiceError(400,"invalid_request","The selected skill is unavailable.");throw error;})).defaults : undefined;
    const defaults = {...team.runDefaults,...owned};
    const executionConfigId = request.executionConfigId ?? defaults.executionConfigId;
    const requiresVm=(request.executionType ?? owned?.executionType)==="code" || (request.requiresVm ?? (request.executionConfigId ? true : defaults.requiresVm ?? false));
    if(request.executionConfigId && request.requiresVm===false)throw new ServiceError(400,"invalid_request","A VM override requires requiresVm=true.");
    const input = {
      ...defaults,
      ...Object.fromEntries(Object.entries(request).filter(([, value]) => value !== undefined)) as TriggerInput,
      executionConfigId,
      concurrencyLimit: request.concurrencyLimit ?? defaults.concurrencyLimit ?? 1,
      modelAccountId: request.executionType === "code" ? undefined : request.modelAccountId ?? defaults.modelAccountId,
    };
    const timestamp = new Date().toISOString(),
      id = crypto.randomUUID();
    const vmImage = input.vmImage ? canonicalizeVmImage(input.vmImage) : input.vmImage;
    const executionType = input.executionType ?? "agent";
    const executionConfig = await this.workspaceConfiguration(input.executionConfigId,requiresVm,executionType,input.tags);
    const portable = await this.portableSelections(executionConfig, executionType, input);
    const events = this.normalizedEvents(input.events).map((event) => ({ ...event, triggerId: id }));
    const skill =
      input.skillId
        ? (await this.skillSelections([input.skillId]))[0]
        : undefined;
    const trigger: Trigger = {
      id,
      runScopes: input.runScopes ?? [...DEFAULT_RUN_SCOPES],
      name: input.name,

      slug: input.name,
      prompt: input.prompt || owned?.prompt || "",
      executionType,
      script: executionType === "code" ? input.script : undefined,
      runNameTemplate: input.runNameTemplate ?? "",
      tags: input.tags ?? [],
      model: input.model ?? "",
      ...portable,
      ...(input.effort ? { effort: input.effort } : {}),
      executionConfig: {
        ...executionConfig,
        skillId: input.skillId ?? undefined,
        ...portable,
        executionType,
        ...(input.script ? { script: input.script } : {}),
        ...(vmImage ? { image: vmImage } : {}),
      },
      concurrencyLimit: input.concurrencyLimit,
      enabled: true,
      events,
      skill,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    try {
      return this.presentTrigger(await this.triggers().create(trigger, defaults.allowedTriggerIds ?? []));
    } catch (error: any) {
      if ((error?.code ?? error?.cause?.code) === "23505") throw new ServiceError(409, "conflict", "This skill already has a trigger, or the resource name is taken");
      if ((error?.code ?? error?.cause?.code) === "23503" && String(error?.constraint ?? error?.cause?.constraint).includes("manual_invocation_permissions")) throw new ServiceError(409, "run_defaults_required", "A default invocation destination is unavailable. Update Team permissions defaults.");
      throw error;
    }
  }
  async updateTrigger(triggerId: string, request: TriggerInput & { expectedUpdatedAt?: string }) {
    await this.authorize("triggers:write");
    const repository = this.triggers(),
      current = await repository.getTrigger(triggerId);
    if (!current) throw new ServiceError(404, "not_found", "Trigger not found");
    const input = {
      ...request,
      executionConfigId: request.executionConfigId ?? current.executionConfig.connectionId,
      concurrencyLimit: request.concurrencyLimit ?? current.concurrencyLimit,
      model: request.model ?? current.model,
      effort: request.effort ?? current.effort,
      tags: request.tags ?? current.tags,
    };
    if(request.executionConfigId && request.requiresVm===false)throw new ServiceError(400,"invalid_request","A VM override requires requiresVm=true.");
    const vmImage = input.vmImage ? canonicalizeVmImage(input.vmImage) : input.vmImage;
    const executionType = input.executionType ?? current.executionType ?? "agent";
    const requiresVm=executionType==="code" || (request.requiresVm ?? (request.executionConfigId ? true : current.executionConfig.requiresVm ?? Boolean(current.executionConfig.connectionId)));
    const executionConfig = await this.workspaceConfiguration(input.executionConfigId,requiresVm,executionType,input.tags);
    const portable = await this.portableSelections(executionConfig, executionType, input, current);
    const events = this.normalizedEvents(input.events, current.events).map((event) => ({
      ...event,
      triggerId,
    }));
    const skillId =
      input.skillId === undefined ? current.skill?.id ?? current.executionConfig.skillId : input.skillId;
    const skill =
      skillId
        ? (await this.skillSelections([skillId]))[0]
        : undefined;
    const updated = await repository
      .update(
        {
          ...current,
          contextReviewRequired:input.skillId !== undefined ? false : current.contextReviewRequired,
          ...portable,
          runScopes: input.runScopes ?? current.runScopes ?? [...DEFAULT_RUN_SCOPES],
          name: input.name,
          description: current.description ?? "",
          slug: input.name,
          prompt: input.prompt ?? "",
          executionType,
          script: executionType === "code" ? input.script : undefined,
          runNameTemplate: input.runNameTemplate ?? "",
          tags: input.tags ?? [],
          model: input.model ?? "",
          effort: input.effort,
          executionConfig: {
            ...executionConfig,
            skillId: skillId ?? undefined,
            ...portable,
            executionType,
            ...(input.script ? { script: input.script } : {}),
            ...(vmImage ? { image: vmImage } : {}),
          },
          concurrencyLimit: input.concurrencyLimit,
          events,
          skill,
              updatedAt: new Date().toISOString(),
        },
        input.expectedUpdatedAt,
      )
      .catch((error) => {
        if ((error?.code ?? error?.cause?.code) === "23505") throw new ServiceError(409, "conflict", "This skill already has a trigger, or the resource name is taken");
        if (error instanceof StaleTriggerEdit)
          throw new ServiceError(
            409,
            "stale_trigger",
            "This trigger changed. Reload its configuration before saving.",
          );
        throw error;
      });
    await this.wakeScheduler();
    return this.presentTrigger(updated);
  }
  async startVmImageVerification(input: unknown) {
    await this.authorize("triggers:write");
    const value = vmImageVerificationInput.parse(input), connection = await this.connections().get<ExeConnection>(`exe:${value.connectionId}`);
    if (!connection) throw new ServiceError(404, "not_found", "exe.dev integration not found");
    const allowedTags = new Set(selectableExeTags(connection));
    if (value.tags.some(tag => !allowedTags.has(tag))) throw new ServiceError(400, "invalid_request", "VM tags must be selected from the available exe.dev labels.");
    const id = crypto.randomUUID(), db = databaseFor(this.env), config = { connectionId: value.connectionId, image: value.image, tags: value.tags, executionType: "code" };
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
      await backend.verifyImage(id, input.image, phase => update(phase));
      await update("succeeded", "Verification passed. Image pull, SSH, and workspace prerequisites worked at this time.");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Image verification failed.";
      const cleanup = message.startsWith("cleanup:"), kind = cleanup ? "cleanup" : message.startsWith("ssh:") ? "ssh" : message.startsWith("agent:") ? "agent" : cause instanceof ExeImageVerificationError ? cause.kind : "image_pull";
      await update(cleanup ? "cleanup_failed" : "failed", "Verification failed", kind, message);
    }
  }
  async getVmImageVerification(id: string) {
    await this.authorize("triggers:read");
    const result = await databaseFor(this.env).pool.query<any>("SELECT id,status,phase,error_kind,error,created_at,updated_at FROM app.vm_image_verifications WHERE tenant_id=$1 AND id=$2", [this.auth.tenantId, id]);
    const row = result.rows[0]; if (!row) throw new ServiceError(404, "not_found", "VM image verification not found");
    return { id: row.id, status: row.status, phase: row.phase, errorKind: row.error_kind, error: row.error, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
  }

  async deleteTrigger(triggerId: string) {
    await this.authorize("triggers:write");
    if (!(await this.triggers().delete(triggerId))) throw new ServiceError(404, "not_found", "Trigger not found");
    return { id: triggerId, deleted: true };
  }
  private async wakeScheduler() {
    if (this.env.SCHEDULER) await this.env.SCHEDULER.get(this.env.SCHEDULER.idFromName("global")).fetch("https://scheduler/wake", { method: "POST" });
  }
  async setTriggerEnabled(triggerId: string, enabled: boolean) { await this.authorize("triggers:write"); const repository = this.triggers(); try { if (!await repository.setEnabled(triggerId, enabled, new Date().toISOString())) throw new ServiceError(404, "not_found", "Trigger not found"); } catch(error) { if(error instanceof ContextReviewRequired) throw new ServiceError(409,"configuration_review_required",error.message); throw error; } await this.wakeScheduler(); return { id: triggerId, enabled }; }
  async getTeam() {
    await this.authorize("team:read");
    const team = await new TeamRepository(databaseFor(this.env), this.auth.tenantId).get();
    if (!team) throw new ServiceError(404, "not_found", "Team not found");
    return team;
  }

  async setTeamRunDefaults(input: z.infer<typeof teamRunDefaults>) {
    await this.authorizeOwnerSession("team:write");
    if (input.allowedTriggerIds?.length) {
      const found = await databaseFor(this.env).pool.query("SELECT id FROM app.triggers WHERE tenant_id=$1 AND id=ANY($2::uuid[])", [this.auth.tenantId, input.allowedTriggerIds]);
      if (found.rowCount !== input.allowedTriggerIds.length) throw new ServiceError(400, "invalid_request", "Every default destination must be a Trigger in this team.");
    }
    if (input.executionConfigId) {
      await this.executionConfig(input.executionConfigId);
      await this.validateExecutionOptions(input.executionConfigId,"","",input.tags ?? []);
      await this.validateSelectedCredentials(input);
    }
    if (!input.executionConfigId) await this.validateSelectedCredentials(input);
    const saved = await new TeamRepository(databaseFor(this.env), this.auth.tenantId).setRunDefaults(input);
    if (!saved) throw new ServiceError(404, "not_found", "Team not found");
    return {...INITIAL_TEAM_DEFAULTS,...input};
  }

  private async resolveRunDefaults(input: z.infer<typeof projectRunDefaults>, executionType: "agent" | "code" = "agent") {
    const config = await this.workspaceConfiguration(input.executionConfigId,executionType==="code" || Boolean(input.requiresVm),executionType,input.tags);
    const portable = await this.portableSelections(config, executionType, input);
    if(executionType==="agent" && (!input.model?.trim() || !portable.modelAccountId))throw new ServiceError(409,"model_configuration_required","Select a model integration and model in the run or Team settings.");
    return {
      ...config,
      ...portable,
      executionType,
      model: input.model ?? "",
      effort: input.effort,
      tags: input.tags ?? [],
      ...(input.vmImage ? { image: input.vmImage } : {}),
      runScopes: input.runScopes ?? [],
    };
  }

  async startRun(input: z.infer<typeof startRunInput>) {
    await this.authorize("runs:start");
    if(input.script && input.skill)throw new ServiceError(400,"invalid_request","Explicit scripts cannot include an agent skill; select the script skill alone to use its saved script.");
    const db = databaseFor(this.env),
      auth = this.auth;
    if (auth.runId) {
      const parent = await db.pool.query("SELECT id FROM app.runs WHERE tenant_id=$1 AND id=$2 AND state IN ('starting','running','blocked')", [auth.tenantId, auth.runId]);
      if (!parent.rowCount) throw new ServiceError(403, "forbidden", "Delegation requires an active parent run in this team.");
    }
    const caller = [
      auth.authMethod ?? "oauth",
      auth.runId ?? auth.vmGrantId ?? auth.accessTokenId ?? auth.oauthGrantId ?? auth.userId,
    ].join(":");
    const claim = auth.tenantId + ":" + (input.idempotencyKey ?? crypto.randomUUID());
    const digest = (
      await db.pool.query("SELECT encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') hash", [
        JSON.stringify(input),
      ])
    ).rows[0].hash;
    const receipt = (runId: string, duplicate: boolean) => ({
      runId,
      url: new URL("/runs/" + runId, this.env.APP_ORIGIN).href,
      outcomeUri: `factorize://runs/${runId}/outcome`,
      duplicate,
    });
    const existing = async (client: DatabaseClient) => {
      const row = (
        await client.query(
          `SELECT r.id,i.request_hash FROM app.invocations i JOIN app.runs r ON r.tenant_id=i.tenant_id AND r.invocation_id=i.id
        WHERE i.tenant_id=$1 AND i.source='direct' AND i.caller=$2 AND i.claim_key=$3`,
          [auth.tenantId, caller, claim],
        )
      ).rows[0];
      if (!row) return null;
      if (row.request_hash !== digest)
        throw new ServiceError(
          409,
          "idempotency_conflict",
          "This key already identifies a different launch request.",
        );
      return receipt(row.id, true);
    };
    const prior = await existing(db.pool);
    if (prior) return prior;
    const team = await new TeamRepository(db, auth.tenantId).get();
    if (!team) throw new ServiceError(404, "not_found", "Team not found");
    const skill = input.skill ? await this.skills().get(input.skill) : null;
    if(input.skill && !skill)throw new ServiceError(404,"not_found","Launch skill not found");
    const skillSettingsSnapshot = skill ? await this.readSkillSettings(skill.id) : undefined;
    const owned = skillSettingsSnapshot?.defaults;
    if(owned?.executionType==="code" && input.script===undefined)input={...input,script:owned.script};
    const defaults = owned ? {...owned,capacity:team.runDefaults.capacity} : team.runDefaults;
    const selectedModelAccountId=input.modelAccountId ?? defaults.modelAccountId;
    const executionConfigId = input.executionConfigId ?? defaults.executionConfigId;
    if(input.executionConfigId && input.requiresVm===false)throw new ServiceError(400,"invalid_request","A VM override requires requiresVm=true.");
    const requiresVm=Boolean(input.script) || (input.requiresVm ?? (input.executionConfigId ? true : defaults.requiresVm ?? false));
    const isAgentClient = auth.authMethod === "oauth" || auth.authMethod === "vm_grant" || auth.authMethod === "vendor_identity" || auth.authMethod === "hosted_pi";
    const access = isAgentClient ? await this.agentApi().reflection() : undefined;
    const effectiveScopes = access?.scopes ?? normalizeScopes(auth.scopes);
    const callerScopes = scopeSchema.options.filter(scope => effectiveScopes.includes(scope));
    const runScopes = input.runScopes ?? (defaults.runScopes ?? callerScopes).filter(scope => callerScopes.includes(scope));
    if (runScopes.some(scope => !callerScopes.includes(scope)))
      throw new ServiceError(403, "forbidden", "Requested run permissions exceed this client's effective Factorize access.");

    const granted = access?.integrations.filter(item => item.access === "granted" &&
      (auth.authMethod !== "oauth" || effectiveScopes.includes("proxy:use"))) ?? [];
    const byId = new Map(granted.map(item => [item.id, item]));
    const permissionFields = ["portableIntegrationIds", "githubInstallationIds", "linearConnectionId", "xConnectionIds", "modelAccountId"] as const;
    const configuredPermissions = permissionFields.some(field => defaults[field] !== undefined);
    const defaultIntegrations = configuredPermissions ? granted.filter(item =>
      item.kind === "bearer" ? defaults.portableIntegrationIds?.includes(item.credentialId) :
      item.kind === "github" ? defaults.githubInstallationIds?.includes(Number(item.credentialId)) :
      item.kind === "linear" ? defaults.linearConnectionId === "linear" :
      item.kind === "x" ? defaults.xConnectionIds?.includes(item.credentialId) :
      item.kind === "model" ? selectedModelAccountId === item.credentialId : false) : granted;
    const integrationIds = input.integrationIds ?? defaultIntegrations.map(item => item.id);
    const selected = integrationIds.map(id => {
      const integration = byId.get(id);
      if (!integration) throw new ServiceError(403, "forbidden", "Requested integrations exceed this client's effective integration access.");
      return integration;
    });
    const inheritConfigured = auth.authMethod === "session" && input.integrationIds === undefined;
    const selections = inheritConfigured ? {...defaults,modelAccountId:selectedModelAccountId} : {
      portableIntegrationIds: selected.filter(item => item.kind === "bearer").map(item => item.credentialId),
      githubInstallationIds: selected.filter(item => item.kind === "github").map(item => Number(item.credentialId)),
      linearConnectionId: selected.some(item => item.kind === "linear") ? "linear" as const : undefined,
      xConnectionIds: selected.filter(item => item.kind === "x").map(item => item.credentialId),
      modelAccountId: selected.find(item => item.kind === "model" && item.credentialId === selectedModelAccountId)?.credentialId,
    };
    if(input.modelAccountId && selections.modelAccountId!==input.modelAccountId)throw new ServiceError(403,"forbidden","The requested model integration exceeds this client's effective integration access.");
    const resolved = await this.resolveRunDefaults({
      ...defaults,
      ...selections,
      capacity: defaults.capacity ?? 4,
      executionConfigId,
      requiresVm,
      vmImage: input.vmImage ?? defaults.vmImage,
      model: input.script ? "" : input.model ?? defaults.model,
      effort: input.script ? undefined : defaults.effort,
      modelAccountId: input.script ? undefined : selections.modelAccountId,
    }, input.script ? "code" : "agent");
    const config = {
      ...resolved,
      runScopes,
      allowedTriggerIds: [] as string[],
      ...(inheritConfigured ? {} : {agentIntegrationIds: integrationIds}),
      inputMediaIds:input.attachments?.map(item=>item.artifactId) ?? [],
      ...(input.script ? {script: input.script} : {}),
    };
    const text=[owned?.prompt ?? "",input.prompt ?? "", input.inputs && Object.keys(input.inputs).length ? "Inputs (JSON)\n"+JSON.stringify(input.inputs) : ""].filter(Boolean).join("\n\n");
    const prompt = composePrompt(skill && !input.script ? {body:skill.body!} : undefined,text);
    const encryptedPrompt = await encrypt(prompt, this.env.CREDENTIAL_ENCRYPTION_KEY);
    const encryptedSkills = skill
      ? await encrypt(
          JSON.stringify([
            { id: skill.id, key: skill.key, revision: skill.revision, body: skill.body, version: skill.version, order: 0 },
          ]),
          this.env.CREDENTIAL_ENCRYPTION_KEY,
        )
      : undefined;
    const result = await db.transaction(async (client) => {
      const locked = await client.query("SELECT run_defaults IS NOT DISTINCT FROM $2::jsonb matches FROM app.team_settings WHERE tenant_id=$1 FOR UPDATE", [auth.tenantId, team.runDefaults]);
      if(skill){const current=(await client.query("SELECT revision,settings_revision FROM app.skills WHERE tenant_id=$1 AND id=$2 FOR SHARE",[auth.tenantId,skill.id])).rows[0];if(!current || current.revision!==skill.revision || current.settings_revision!==skillSettingsSnapshot!.revision)throw new ServiceError(409,"configuration_changed","Skill changed. Retry this request.");}
      const duplicate = await existing(client);
      if (duplicate) return duplicate;
      if (!locked.rows[0]?.matches)
        throw new ServiceError(
          409,
          "configuration_changed",
          "Team configuration changed. Retry this request.",
        );
      if (auth.runId) {
        const active = await client.query(
          "SELECT id,trigger_id,execution_config FROM app.runs WHERE tenant_id=$1 AND id=$2 AND state IN ('starting','running','blocked') FOR SHARE",
          [auth.tenantId, auth.runId],
        );
        if (!active.rowCount) throw new ServiceError(403, "forbidden", "The parent run is no longer active.");
        const parent=active.rows[0];
        const destinations=parent.trigger_id
          ? (await client.query("SELECT destination_trigger_id FROM app.manual_invocation_permissions WHERE tenant_id=$1 AND source_trigger_id=$2 FOR SHARE",[auth.tenantId,parent.trigger_id])).rows.map(row=>row.destination_trigger_id)
          : parent.execution_config.allowedTriggerIds ?? [];
        config.allowedTriggerIds=(defaults.allowedTriggerIds ?? []).filter(id=>destinations.includes(id));
      } else {
        config.allowedTriggerIds=defaults.allowedTriggerIds ?? [];
      }
      if (!config.runScopes.includes("runs:invoke")) config.allowedTriggerIds=[];
      const id = crypto.randomUUID(),
        invocationId = crypto.randomUUID(),
        inputs = input.inputs ?? {};
      await client.query(
        `INSERT INTO app.invocations(tenant_id,id,source,claim_key,caller,request_hash,context,source_run_id,source_trigger_id)
        VALUES ($1,$2,'direct',$3,$4,$5,$6,$7,$8)`,
        [auth.tenantId, invocationId, claim, caller, digest, inputs, auth.runId, auth.runTriggerId],
      );
      await submitRun(client, auth.tenantId, {
        id,
        invocationId,
        triggerId: null,
        name: input.name ?? (skill ? `/${skill.key} run` : "Direct run"),
        source: "direct",
        claim,
        encryptedPrompt,
        encryptedSkills,
        encryptedPromptPreview:await encrypt(runPromptPreview(input.script??(text || (config.inputMediaIds.length?`[${config.inputMediaIds.length} image${config.inputMediaIds.length===1?"":"s"}]`:""))),this.env.CREDENTIAL_ENCRYPTION_KEY),
        encryptedContextPrompt:await encrypt(input.script??text,this.env.CREDENTIAL_ENCRYPTION_KEY),
        skill: skill ?? undefined,
        config: { ...config, inputContext: inputs },
        workspaceName: "",
        createdAt: new Date().toISOString(),
      });
      await new RunMedia(db,this.env,auth).attach(client,id,config.inputMediaIds);
      await client.query(
        "INSERT INTO app.run_authorizations(tenant_id,run_id,user_id,session_version,scopes) VALUES ($1,$2,$3,$4,$5::jsonb)",
        [auth.tenantId, id, auth.userId, auth.sessionVersion, JSON.stringify(config.runScopes)],
      );
      return receipt(id, false);
    });
    await this.wakeScheduler();
    return result;
  }

  async outcomeStates(ids: string[]) {
    await this.authorize("runs:read");
    const { rows } = await databaseFor(this.env).pool.query<{ id: string; outcome_id: string | null }>(
      "SELECT id,outcome_id FROM app.runs WHERE tenant_id=$1 AND id=ANY($2::uuid[])",
      [this.auth.tenantId, ids],
    );
    if (rows.length !== ids.length) throw new ServiceError(404, "not_found", "Run not found");
    return rows;
  }
  async runOutcome(runId: string) {
    await this.authorize("runs:read");
    const db = databaseFor(this.env);
    const result = await db.pool.query(
      `SELECT id AS "runId",state,outcome_id AS "eventId",trigger_result AS result,
      CASE WHEN failure_code IS NOT NULL THEN json_build_object('code',failure_code,'reason',failure_reason,'source',CASE WHEN failure_source='agent' THEN 'run' ELSE 'system' END) END failure
      FROM app.runs WHERE tenant_id=$1 AND id=$2`,
      [this.auth.tenantId, runId],
    );
    if (!result.rowCount) throw new ServiceError(404, "not_found", "Run not found");
    const outcome = result.rows[0];
    const artifacts = outcome.eventId ? await new ArtifactRepository(db, this.auth.tenantId).list(runId) : [];
    return {
      ...outcome,
      url: new URL("/runs/" + runId, this.env.APP_ORIGIN).href,
      artifacts: artifacts
        .filter((item) => item.kind === "trigger_file")
        .map((item) => ({ id: item.id, format: item.format })),
    };
  }
  async invokeTrigger(triggerId: string, input: ManualInvocationInput) {
    await this.authorize("runs:invoke"); const repository = this.triggers(), trigger = await repository.getTrigger(triggerId); if (!trigger) throw new ServiceError(404, "not_found", "Trigger not found");
    const runIdentity=this.auth.authMethod==="vendor_identity"||this.auth.authMethod==="hosted_pi";
    if (runIdentity) {
      if (!this.auth.runId) throw new ServiceError(401, "invalid_token", "A verified run identity is required.");
      const permission = await databaseFor(this.env).pool.query(`SELECT 1 FROM app.runs r
          JOIN app.triggers destination ON destination.tenant_id=r.tenant_id AND destination.id=$3
          WHERE r.tenant_id=$1 AND r.id=$2 AND r.state IN ('starting','running','blocked')
            AND ($5::boolean OR EXISTS(SELECT 1 FROM app.vendor_run_identity_bindings b WHERE b.tenant_id=r.tenant_id AND b.run_id=r.id AND b.provider=$4 AND b.revoked_at IS NULL))
            AND ((r.trigger_id IS NULL AND COALESCE(r.execution_config->'allowedTriggerIds','[]'::jsonb) ? $3::text)
              OR EXISTS(SELECT 1 FROM app.manual_invocation_permissions p WHERE p.tenant_id=r.tenant_id AND p.source_trigger_id=r.trigger_id AND p.destination_trigger_id=$3))`, [this.auth.tenantId, this.auth.runId, triggerId, this.auth.runIdentityProvider ?? null,this.auth.authMethod==="hosted_pi"]);
      if (!permission.rowCount) throw new ServiceError(403, "forbidden", "This run is no longer active or its source trigger is not authorized to invoke the destination.");
    }
    const event = trigger.events.find(value => value.kind === "manual" && value.enabled); if (!event) throw new ServiceError(409, "operation_failed", "The manual event is disabled");
    const service = new InvocationService(repository, value => encrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY));
    const claimKey = input.idempotencyKey ? `manual:${runIdentity ? `run:${this.auth.runId}:` : ""}${input.idempotencyKey}` : `manual:${crypto.randomUUID()}`;
    const result = await service.invoke(triggerId, { source: "manual", name: input.name, eventId: event.id, claimKey, ...(runIdentity ? { sourceTriggerId: this.auth.runTriggerId, sourceRunId: this.auth.runId } : {}), context: { [event.slug]: { prompt: input.prompt, data: input.data ?? {} } } });
    if (this.env.SCHEDULER) await this.env.SCHEDULER.get(this.env.SCHEDULER.idFromName("global")).fetch("https://scheduler/wake", { method: "POST" });
    return { invocationId: result.invocation.id, runId: result.run.id, state: result.run.state, duplicate: result.duplicate };
  }
  async getInvocationPermissions(sourceTriggerId: string) {
    await this.authorize("triggers:read");
    if (!await this.triggers().getTrigger(sourceTriggerId)) throw new ServiceError(404, "not_found", "Trigger not found");
    const rows = await databaseFor(this.env).pool.query<{ destination_trigger_id: string }>(`SELECT p.destination_trigger_id FROM app.manual_invocation_permissions p
      JOIN app.triggers source ON source.tenant_id=p.tenant_id AND source.id=p.source_trigger_id
      JOIN app.triggers destination ON destination.tenant_id=p.tenant_id AND destination.id=p.destination_trigger_id
      WHERE p.tenant_id=$1 AND p.source_trigger_id=$2 ORDER BY p.destination_trigger_id`, [this.auth.tenantId, sourceTriggerId]);
    return publicValue(invocationPermissionsResponse, { sourceTriggerId, destinationTriggerIds: rows.rows.map(row => row.destination_trigger_id) });
  }
  async setInvocationPermissions(sourceTriggerId: string, destinationTriggerIds: string[]) {
    await this.authorize("triggers:write");
    // A run with triggers:write still cannot expand its invocation destinations.
    if (["vendor_identity","hosted_pi"].includes(this.auth.authMethod ?? "")) throw new ServiceError(403, "insufficient_scope", "Run credentials cannot change invocation permissions.");
    const unique = [...new Set(destinationTriggerIds)];
    if (unique.length !== destinationTriggerIds.length) throw new ServiceError(400, "invalid_request", "Destination triggers must be unique.");
    const db = databaseFor(this.env);
    await db.transaction(async client => {
      const sources = await client.query<{ id: string }>("SELECT id FROM app.triggers WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [this.auth.tenantId, sourceTriggerId]);
      if (!sources.rowCount) throw new ServiceError(404, "not_found", "Source trigger not found");
      if (unique.length) {
        const found = await client.query("SELECT id FROM app.triggers WHERE tenant_id=$1 AND id=ANY($2::uuid[])", [this.auth.tenantId, unique]);
        if (found.rowCount !== unique.length) throw new ServiceError(400, "invalid_request", "Every destination must be an existing trigger in the source trigger's team.");
      }
      await client.query("DELETE FROM app.manual_invocation_permissions WHERE tenant_id=$1 AND source_trigger_id=$2", [this.auth.tenantId, sourceTriggerId]);
      if (unique.length) await client.query("INSERT INTO app.manual_invocation_permissions(tenant_id,source_trigger_id,destination_trigger_id) SELECT $1,$2,unnest($3::uuid[])", [this.auth.tenantId, sourceTriggerId, unique]);
    });
    return publicValue(invocationPermissionsResponse, { sourceTriggerId, destinationTriggerIds: unique });
  }
  async diagnoseExeIntegration(connectionId: string) { await this.authorize("integrations:write"); const value = await new IntegrationService(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY).diagnoseExe(connectionId); if (!value) throw new ServiceError(404,"not_found","Integration not found"); return value; }
  async listTriggerEventAvailability() { await this.authorize("triggers:read"); const [kinds, installations] = await Promise.all([this.connections().kinds(), new GitHubRepository(databaseFor(this.env),this.auth.tenantId).installations()]), states=installations.map((x:any)=>x.state); return installedEventAvailability(kinds.includes("linear"),kinds.includes("clickup"),states,kinds.filter(x=>x.startsWith("cloudflare-tail:")).length); }
  async previewSchedule(input: unknown) {
    await this.authorize("triggers:read");
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
  async removeIntegration(kind: "exe" | "amp", id: string) { await this.authorize("integrations:write"); const result = await this.integrations().remove(kind, id); if (result.conflict) throw new ServiceError(409, "conflict", "This integration is used by a trigger."); if (!result.deleted) throw new ServiceError(404, "not_found", "Integration not found"); return { id, deleted: true }; }
  async saveAmpIntegration(input: any) { await this.authorize("integrations:write"); return this.integrations().saveAmp(input); }
  async testAmpIntegration(input: any) { await this.authorize("integrations:write"); return this.integrations().testAmp(input); }
  async saveTailIntegration(input: any) { await this.authorize("integrations:write"); return this.integrations().saveTail(input); }
  async testTailIntegration(id: string) { await this.authorize("integrations:write"); const result = await this.integrations().testTail(id); if (!result) throw new ServiceError(404, "not_found", "Integration not found"); return result; }
  private credentials() { return new CredentialRepository(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY); }
  private xConnections() { return new XConnectionRepository(databaseFor(this.env), this.auth.tenantId, this.env.CREDENTIAL_ENCRYPTION_KEY); }
  async listXConnections() {
    await this.authorizeOwnerSession("integrations:read");
    return { connections: await this.xConnections().list() };
  }
  async createXConnection(input: { id: string; name: string; clientId: string; clientSecret: string; scopes: string[] }) {
    await this.authorizeOwnerSession("integrations:write");
    let scopes: XOAuthScope[];
    try { scopes = validateXOAuthScopes(input.scopes); }
    catch (error) { throw new ServiceError(400, "invalid_request", error instanceof Error ? error.message : "Invalid X scopes."); }
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(input.clientId)) throw new ServiceError(400, "invalid_request", "Enter a valid X OAuth 2.0 client ID.");
    if (!input.clientSecret.trim() || input.clientSecret.length > 4096 || /[\r\n]/.test(input.clientSecret)) throw new ServiceError(400, "invalid_request", "Enter a valid X OAuth client secret.");
    if ((await this.xConnections().get(input.id)) !== null) throw new ServiceError(409, "conflict", "X connection already exists.");
    try { return await this.xConnections().create({ ...input, name: input.name.trim(), clientId: input.clientId.trim(), scopes }); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "23505") throw new ServiceError(409, "conflict", "An X connection with this name already exists.");
      throw error;
    }
  }
  async deleteXConnection(id: string) {
    await this.authorizeOwnerSession("integrations:write");
    const credentials = await this.xConnections().disconnect(id);
    if (!credentials) throw new ServiceError(404, "not_found", "X connection not found.");
    // Local revocation is committed before contacting X. Upstream availability
    // must never keep a disconnected run grant usable.
    for (const token of [credentials.refreshToken, credentials.accessToken].filter((value): value is string => Boolean(value))) {
      try {
        await fetch("https://api.x.com/2/oauth2/revoke", {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(5_000),
          headers: { Authorization: `Basic ${btoa(`${credentials.clientId}:${credentials.clientSecret}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token, token_type_hint: token === credentials.refreshToken ? "refresh_token" : "access_token" }),
        });
      } catch { /* Best effort after local run access has already been revoked. */ }
    }
    return { id, deleted: true as const };
  }
  async testXConnection(id: string) {
    await this.authorizeOwnerSession("integrations:read");
    const repository = this.xConnections(), connection = await repository.get(id);
    if (!connection || connection.status === "revoked") throw new ServiceError(404, "not_found", "X connection not found.");
    if (connection.status !== "connected") return { status: "reconnect_required" as const, accountHandle: connection.accountHandle, message: "Reconnect this X connection before testing it." };
    const credentials = await repository.clientCredentials(id);
    if (!credentials?.accessToken || !credentials.expiresAt || Date.parse(credentials.expiresAt) <= Date.now())
      return { status: "reconnect_required" as const, accountHandle: connection.accountHandle, message: "Reconnect this X connection before testing it." };
    try {
      const response = await fetch("https://api.x.com/2/users/me?user.fields=id%2Cusername", {
        method: "GET", redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${credentials.accessToken}`, Accept: "application/json" },
      });
      if (response.status === 401) return { status: "reconnect_required" as const, accountHandle: connection.accountHandle, message: "X rejected this authorization. Reconnect the connection." };
      if (!response.ok) return { status: "failed" as const, accountHandle: connection.accountHandle, message: "X could not verify the connection. Try again later." };
      const me = await response.json() as { data?: { id?: unknown; username?: unknown } };
      if (me.data?.id !== connection.accountId || me.data?.username !== connection.accountHandle)
        return { status: "failed" as const, accountHandle: connection.accountHandle, message: "X returned an account that does not match this connection." };
      return { status: "connected" as const, accountHandle: connection.accountHandle, message: "X connection verified." };
    } catch {
      return { status: "failed" as const, accountHandle: connection.accountHandle, message: "X could not verify the connection. Try again later." };
    }
  }
  async replaceXConnectionCredentials(id: string, input: { clientId: string; clientSecret: string }) {
    await this.authorizeOwnerSession("integrations:write");
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(input.clientId)) throw new ServiceError(400, "invalid_request", "Enter a valid X OAuth 2.0 client ID.");
    if (!input.clientSecret.trim() || input.clientSecret.length > 4096 || /[\r\n]/.test(input.clientSecret)) throw new ServiceError(400, "invalid_request", "Enter a valid X OAuth client secret.");
    const updated = await this.xConnections().replaceClientCredentials(id, { clientId: input.clientId.trim(), clientSecret: input.clientSecret });
    if (!updated) throw new ServiceError(404, "not_found", "X connection not found.");
    return updated;
  }
  async authorizeXConnection(id: string) {
    await this.authorizeOwnerSession("integrations:write");
    const repository = this.xConnections(), connection = await repository.get(id);
    if (connection?.status === "revoked") throw new ServiceError(404, "not_found", "X connection not found.");
    const credentials = await repository.clientCredentials(id);
    if (!connection || !credentials) throw new ServiceError(404, "not_found", "X connection not found.");
    const scopes = validateXOAuthScopes(connection.scopes);
    const pkce = await createXPKCE(), nonce = crypto.randomUUID(), expires = Math.floor(Date.now() / 1000) + 600;
    const state = await signXOAuthState({ tenantId: this.auth.tenantId, userId: this.auth.userId, sessionVersion: this.auth.sessionVersion, connectionId: id, scopes, nonce, exp: expires }, this.env.SESSION_SIGNING_SECRET);
    const saved = await repository.createOAuthAttempt({ nonce, userId: this.auth.userId, sessionVersion: this.auth.sessionVersion, connectionId: id, scopes, verifier: pkce.verifier, expiresAt: new Date(expires * 1000) });
    if (!saved) throw new ServiceError(404, "not_found", "X connection not found.");
    const redirectUri = `${this.env.APP_ORIGIN}/oauth/x/callback`, authorize = new URL("https://x.com/i/oauth2/authorize");
    authorize.search = new URLSearchParams({ response_type: "code", client_id: credentials.clientId, redirect_uri: redirectUri, scope: scopes.join(" "), state, code_challenge: pkce.challenge, code_challenge_method: "S256" }).toString();
    return { authorizationUrl: authorize.toString(), stateCookie: state };
  }
  private async bearerWrite(input: { id: string; expectedRevision: number; idempotencyKey: string; name: string; origin: string; description: string | null; token?: string; operation: "upsert" | "delete" }) {
    try { return await this.credentials().write({ ...input, managedSecret: input.token, kind: "bearer" }); }
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
    const [revision, records] = await Promise.all([this.credentials().revision(), this.credentials().metadata("bearer")]);
    // Secret values are only read by the server-side credential control path.
    return { revision, integrations: records };
  }
  async createBearerIntegration(input: { id: string; expectedRevision: number; idempotencyKey: string; name: string; origin: string; description: string | null; token: string }) {
    await this.authorizeOwnerSession("integrations:write"); this.validateBearerOrigin(input.origin);
    if ((await this.credentials().metadata("bearer")).some(record => record.id === input.id)) throw new ServiceError(409, "conflict", "Integration already exists.");
    return this.bearerWrite({ ...input, operation: "upsert" });
  }
  async updateBearerIntegration(id: string, input: { expectedRevision: number; idempotencyKey: string; name: string; origin: string; description: string | null; token: string }) {
    await this.authorizeOwnerSession("integrations:write"); this.validateBearerOrigin(input.origin);
    const existing = (await this.credentials().metadata("bearer")).find(record => record.id === id);
    if (!existing) throw new ServiceError(404, "not_found", "Integration not found.");
    return this.bearerWrite({ ...input, id, operation: "upsert" });
  }
  async deleteBearerIntegration(id: string, input: { expectedRevision: number; idempotencyKey: string }) {
    await this.authorizeOwnerSession("integrations:write");
    const existing = (await this.credentials().metadata("bearer")).find(record => record.id === id && record.origin !== null);
    if (!existing) throw new ServiceError(404, "not_found", "Integration not found.");
    const result = await this.bearerWrite({ id, name: existing.name, origin: existing.origin!, description: existing.description, ...input, operation: "delete" });
    return { id, deleted: true as const, ...result };
  }
  async listModelAccounts() {
    await this.authorizeOwnerSession("integrations:read");
    const repository = this.credentials();
    const [revision, accounts] = await Promise.all([repository.revision(), repository.metadata("model")]);
    return {revision, accounts: await Promise.all(accounts.map(async ({id,name,description,revision}) => {const config=configuredPiProvider((await repository.managedCredential(id,"model"))?.payload ?? "");return {id,name,description,revision,credentialConfigured:Boolean(config),providerUrl:config?.providerUrl ?? null,contextWindow:config?.contextWindow ?? null,maxTokens:config?.maxTokens ?? null};}))};
  }
  private async modelAccountWrite(input: { id: string; expectedRevision: number; idempotencyKey: string; name: string; description: string | null; operation: "upsert" | "delete" }) {
    try { return await this.credentials().write({ ...input, kind: "model", origin: null }); }
    catch (error) {
      if (error instanceof StaleIntegrationRevisionError) throw new ServiceError(409, "stale_revision", `The model account collection changed. Current revision is ${error.currentRevision}.`);
      if (error instanceof IntegrationIdempotencyConflictError) throw new ServiceError(409, "conflict", "The idempotency key was already used for a different model account change.");
      if (error instanceof IntegrationValidationError) throw new ServiceError(400, "invalid_request", error.message);
      throw error;
    }
  }
  async createModelAccount(input: { id: string; expectedRevision: number; idempotencyKey: string; name: string; description: string | null } & ModelProviderConfiguration) {
    await this.authorizeOwnerSession("integrations:write");
    const repository = this.credentials();
    const managed = { ...input, managedModelPayload: JSON.stringify(modelProviderConfiguration.parse({providerUrl:input.providerUrl,apiKey:input.apiKey,contextWindow:input.contextWindow,maxTokens:input.maxTokens})), kind: "model" as const, origin: null, operation: "upsert" as const };
    try {
      const replay = await repository.replay(managed);
      if (replay) return replay;
    } catch (error) {
      if (error instanceof IntegrationIdempotencyConflictError) throw new ServiceError(409, "conflict", "The idempotency key was already used for a different model account change.");
      if (error instanceof IntegrationValidationError) throw new ServiceError(400, "invalid_request", error.message);
      throw error;
    }
    if ((await repository.metadata()).some(record => record.id === input.id)) throw new ServiceError(409, "conflict", "An integration with this id already exists.");
    try { return await repository.write(managed); }
    catch (error) {
      if (error instanceof StaleIntegrationRevisionError) throw new ServiceError(409, "stale_revision", `The model account collection changed. Current revision is ${error.currentRevision}.`);
      if (error instanceof IntegrationIdempotencyConflictError) throw new ServiceError(409, "conflict", "The idempotency key was already used for a different model account change.");
      if (error instanceof IntegrationValidationError) throw new ServiceError(400, "invalid_request", error.message);
      throw error;
    }
  }
  async updateModelAccount(id: string, input: {expectedRevision: number; idempotencyKey: string; name: string; description: string | null} & ModelProviderConfiguration) {
    await this.authorizeOwnerSession("integrations:write");
    const repository=this.credentials();
    if (!(await repository.metadata("model")).some(record=>record.id===id)) throw new ServiceError(404,"not_found","Model account not found.");
    try {return await repository.write({...input,id,kind:"model",origin:null,operation:"upsert",managedModelPayload:JSON.stringify(modelProviderConfiguration.parse({providerUrl:input.providerUrl,apiKey:input.apiKey,contextWindow:input.contextWindow,maxTokens:input.maxTokens}))});}
    catch (error) {if(error instanceof StaleIntegrationRevisionError) throw new ServiceError(409,"stale_revision","The model account collection changed. Reload and retry."); if(error instanceof IntegrationIdempotencyConflictError) throw new ServiceError(409,"conflict",error.message); if(error instanceof IntegrationValidationError) throw new ServiceError(400,"invalid_request",error.message); throw error;}
  }
  async deleteModelAccount(id: string, input: { expectedRevision: number; idempotencyKey: string }) {
    await this.authorizeOwnerSession("integrations:write");
    const repository = this.credentials();
    const existing = (await repository.metadata("model")).find(record => record.id === id);
    if (!existing) {
      try {
        const replay = await repository.replayDelete(id, "model", input.idempotencyKey);
        if (replay) return { id, deleted: true as const, ...replay };
      } catch (error) {
        if (error instanceof IntegrationIdempotencyConflictError) throw new ServiceError(409, "conflict", "The idempotency key was already used for a different model account change.");
        if (error instanceof IntegrationValidationError) throw new ServiceError(400, "invalid_request", error.message);
        throw error;
      }
      throw new ServiceError(404, "not_found", "Model account not found.");
    }
    const result = await this.modelAccountWrite({ id, name: existing.name, description: existing.description, ...input, operation: "delete" });
    return { id, deleted: true as const, ...result };
  }
  async removeTailIntegration(id: string) { await this.authorize("integrations:write"); if (!await this.connections().delete(`cloudflare-tail:${id}`)) throw new ServiceError(404, "not_found", "Integration not found"); return { id, deleted: true }; }
  async linearProjects() { await this.authorize("integrations:read"); return publicValue(z.array(namedOption), await this.providers().linearProjects()); }
  async linearOptions() { await this.authorize("integrations:read"); return publicValue(providerOptions, await this.providers().linearOptions()); }
  async clickUpLists() { await this.authorize("integrations:read"); return publicValue(z.array(namedOption), await this.providers().clickUpLists()); }
  async clickUpOptions(listId: string) { await this.authorize("integrations:read"); return publicValue(providerOptions, await this.providers().clickUpOptions(listId)); }
  async githubRepositories(installationId: number) { await this.authorize("integrations:read"); return publicValue(z.array(githubRepository), await this.providers().githubRepositories(installationId)); }
  async githubIssueOptions(installationId: number, repositoryId: number) { await this.authorize("integrations:read"); return publicValue(providerOptions, await this.providers().githubIssueOptions(installationId, repositoryId)); }
  async removeGitHubInstallation(id: number) { await this.authorize("integrations:write"); if (!await new GitHubRepository(databaseFor(this.env), this.auth.tenantId).delete(id)) throw new ServiceError(404, "not_found", "Installation not found"); return { id, deleted: true }; }

  async renameMcpClient(input: unknown) {
    const { name } = clientNameInput.parse(input);
    if (this.auth.authMethod !== "oauth") throw new ServiceError(403, "forbidden", "An OAuth connection is required.");
    const identity = await this.agentApi().identity();
    await databaseFor(this.env).pool.query("UPDATE app.agent_identities SET display_name=$3 WHERE tenant_id=$1 AND id=$2", [this.auth.tenantId, identity.id, name]);
    return { name };
  }
  async updateClientPermissions(grantId: string, input: unknown) {
    await this.authorizeOwnerSession("triggers:write");
    const edit = clientPermissionsInput.parse(input);
    const client = (await this.listAuthorizedClients()).find(client => client.grantId === grantId);
    if (!client) throw new ServiceError(404, "not_found", "Authorization not found.");
    if (edit.disabledScopes.some(scope => !client.availableScopes.includes(scope))) throw new ServiceError(400, "invalid_request", "Scope is outside this authorization.");
    const { integrations } = await listAgentPolicies(this.env, this.auth.tenantId);
    const current = new Map(integrations.map(row => [row.id, row]));
    if (Object.entries(edit.integrationOverrides).some(([id, approval]) => {
      const row = current.get(id);
      return !row || (approval !== false && (!row.available || row.policy === "disabled" || approval !== row.requiredScope));
    })) throw new ServiceError(409, "conflict", "Integration availability changed. Reload permissions.");
    const result = await databaseFor(this.env).pool.query(`
      INSERT INTO app.agent_identities AS i(tenant_id,kind,subject,user_id,session_version,disabled_scopes,integration_overrides,permissions_revision)
      SELECT $1,'oauth',$2,$3,$4,$5,$6,1 WHERE coalesce($7::integer,0)=0 OR EXISTS
        (SELECT 1 FROM app.agent_identities WHERE tenant_id=$1 AND kind='oauth' AND subject=$2)
      ON CONFLICT(tenant_id,kind,subject) DO UPDATE SET disabled_scopes=excluded.disabled_scopes,
        integration_overrides=excluded.integration_overrides, permissions_revision=i.permissions_revision+1
      WHERE i.revoked_at IS NULL AND i.user_id=excluded.user_id AND ($7 IS NULL OR i.permissions_revision=$7)
      RETURNING permissions_revision`, [this.auth.tenantId, grantId, this.auth.userId, this.auth.sessionVersion, edit.disabledScopes, JSON.stringify(edit.integrationOverrides), edit.expectedRevision]);
    if (!result.rowCount) throw new ServiceError(409, "conflict", "Connection permissions changed. Reload permissions.");
    return { ok: true };
  }
  async listAuthorizedClients() {
    await this.authorizeOwnerSession("triggers:read");
    if (!this.env.OAUTH_PROVIDER) throw new ServiceError(503, "operation_failed", "OAuth management unavailable");
    const grants: any[] = []; let cursor: string | undefined;
    do { const page = await this.env.OAUTH_PROVIDER.listUserGrants(this.auth.userId, { limit: 100, cursor }); grants.push(...page.items.filter(grant => (grant.metadata as any)?.tenantId === this.auth.tenantId && (!grant.expiresAt || grant.expiresAt > Math.floor(Date.now() / 1000)))); cursor = page.cursor; } while (cursor);
    const clients = await Promise.all([...new Set(grants.map(grant => grant.clientId))].map(async clientId => [clientId, await this.env.OAUTH_PROVIDER!.lookupClient(clientId)] as const));
    const byId = new Map(clients);
    const settings = await databaseFor(this.env).pool.query("SELECT subject,display_name,disabled_scopes,integration_overrides,permissions_revision FROM app.agent_identities WHERE tenant_id=$1 AND user_id=$2 AND kind='oauth' AND subject=ANY($3)", [this.auth.tenantId, this.auth.userId, grants.map(g => g.id)]);
    const byGrant = new Map(settings.rows.map(row => [row.subject, row]));
    return publicValue(z.array(authorizedClient), grants.map(grant => {
      const row = byGrant.get(grant.id), availableScopes = normalizeScopes(grant.scope);
      return { grantId: grant.id, clientId: grant.clientId, clientName: row?.display_name ?? byId.get(grant.clientId)?.clientName ?? grant.clientId,
        availableScopes: availableScopes.filter(scope => !scope.startsWith("integration:")), scopes: availableScopes.filter(scope => !row?.disabled_scopes.includes(scope)), revision: row?.permissions_revision ?? 0,
        integrationOverrides: row?.integration_overrides ?? {}, authorizationDate: new Date(grant.createdAt * 1000).toISOString(),
        expiresAt: grant.expiresAt ? new Date(grant.expiresAt * 1000).toISOString() : null, lastUsedAt: null };
    }));
  }
  async revokeOAuthAuthorization(grantId: string) {
    await this.authorizeOwnerSession("triggers:write");
    if (!this.env.OAUTH_PROVIDER) throw new ServiceError(503,"operation_failed","OAuth management unavailable");
    let cursor: string | undefined, found = false;
    do { const page = await this.env.OAUTH_PROVIDER.listUserGrants(this.auth.userId,{limit:100,cursor}); found ||= page.items.some(grant=>grant.id===grantId && (grant.metadata as any)?.tenantId===this.auth.tenantId); cursor=page.cursor; } while(cursor && !found);
    if(!found) throw new ServiceError(404,"not_found","Authorization not found");
    await databaseFor(this.env).pool.query("INSERT INTO app.agent_identities(tenant_id,kind,subject,user_id,session_version,revoked_at) VALUES($1,'oauth',$2,$3,$4,now()) ON CONFLICT(tenant_id,kind,subject) DO UPDATE SET revoked_at=now()",[this.auth.tenantId,grantId,this.auth.userId,this.auth.sessionVersion]);
    await this.env.OAUTH_PROVIDER.revokeGrant(grantId,this.auth.userId);
    return {revoked:1};
  }
  async revokeAuthorizedClient(clientId: string) {
    await this.authorizeOwnerSession("triggers:write");
    if (!this.env.OAUTH_PROVIDER) throw new ServiceError(503,"operation_failed","OAuth management unavailable");
    const grants: any[]=[]; let cursor: string | undefined;
    do { const page=await this.env.OAUTH_PROVIDER.listUserGrants(this.auth.userId,{limit:100,cursor});grants.push(...page.items.filter(grant=>grant.clientId===clientId && (grant.metadata as any)?.tenantId===this.auth.tenantId));cursor=page.cursor; } while(cursor);
    for (const grant of grants) await this.revokeOAuthAuthorization(grant.id);
    return {revoked:grants.length};
  }
  async listAccessTokens() { await this.authorizeOwnerSession("triggers:read"); return publicValue(z.array(accessToken), (await new AccessTokenRepository(databaseFor(this.env), this.auth.tenantId).list()).map(token => ({ ...token, created_at: new Date(token.created_at).toISOString(), expires_at: new Date(token.expires_at).toISOString(), last_used_at: token.last_used_at ? new Date(token.last_used_at).toISOString() : null, revoked_at: token.revoked_at ? new Date(token.revoked_at).toISOString() : null, scopes: normalizeScopes(token.scopes) }))); }
  async createAccessToken(input: any) { await this.authorizeOwnerSession("triggers:write"); const name = typeof input?.name === "string" ? input.name.trim() : "", requested: string[] = Array.isArray(input?.scopes) ? [...new Set<string>(input.scopes.filter((scope: unknown): scope is string => typeof scope === "string"))] : [], scopes = normalizeScopes(requested), expiryDays = Number(input?.expiryDays); if (!name || name.length > 100 || !requested.length || requested.some(scope => !ACCESS_SCOPES.includes(scope as any)) || !scopes.length || ![7, 30, 90].includes(expiryDays)) throw new ServiceError(400, "invalid_request", "A name, supported scopes, and expiryDays of 7, 30, or 90 are required."); const token = issueAccessToken(this.auth.tenantId), expiresAt = new Date(Date.now() + expiryDays * 86_400_000).toISOString(); const metadata = await new AccessTokenRepository(databaseFor(this.env), this.auth.tenantId).create({ name, scopes, expiresAt, digest: await accessTokenDigest(token), userId: this.auth.userId, sessionVersion: this.auth.sessionVersion }); if (!metadata) throw new ServiceError(401, "invalid_token", "The owner session is no longer active."); return publicValue(createdAccessToken, JSON.parse(JSON.stringify({ ...metadata, token }))); }
  async revokeAccessToken(id: string) { await this.authorizeOwnerSession("triggers:write"); if (!await new AccessTokenRepository(databaseFor(this.env), this.auth.tenantId).revoke(id)) throw new ServiceError(404, "not_found", "Access token not found"); return { revoked: true }; }
}
