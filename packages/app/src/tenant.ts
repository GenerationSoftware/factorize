import { DurableObject } from "cloudflare:workers";
import Mustache from "mustache";
import { decrypt, encrypt, equalHmac } from "./crypto";
import { agentListCommand, agentOutputCommand, agentStartupBlocked, agentStatusCommand, connectionCheckCommand, defaultAgentCommand, exec, garbageCollectPaneCommand, herdrAgentStatus, herdrCheckCommand, paneGetCommand, paneProcessInfoCommand, replaceForegroundCommand, startAgentCommand, startAgentInPaneCommand, stopAgentCommand, validateWorktreeLeaseCommand, type ExeConnection } from "./exe";
import { findOwnedAgent, ownsPane, parseAgent, parseAgentList, parsePaneProcess, type HerdrIdentity } from "./recovery";
import { LINEAR_ISSUE_PROJECT_QUERY, LINEAR_OPTION_QUERIES, LINEAR_PROJECTS_QUERY, isLinearAuthenticationError, refreshLinearToken } from "./linear";
import { matchingIssue } from "./matcher";
import type { AmpConnectionInput, Env, ExeConnectionInput, FilterType, MatchRule, RunState, TailIntegrationInput } from "./types";
import { workingDirectoryFor, workspaceNameFor } from "./workspace";
import { githubClaimKey, githubHeaders, installationToken, normalizeRepository, renderGitHubPrompt } from "./github";
import type { WorkItem } from "./types";
import { invokeCustomHandler } from "./custom-handler";
import { generateTailSecret, sanitizeTailEvent, signTailDelivery, suppressTailEvent, tailFingerprint, verifyTailDelivery } from "./cloudflare-tail";
import { ExeHerdrBackend } from "./exe-herdr-backend";
import { AmpBackend, type AmpConnection } from "./amp-backend";
import { DEFAULT_CONTEXT_TEMPLATE, LinearSourceAdapter, linearTicketPrompt, renderContextTemplate } from "./linear-source";
import { JOB_SCHEMA, renderJobPrompt } from "./job-domain";
import { normalizeExecutionState, type RunHandle } from "./execution";
import { catchUpOccurrence, nextOccurrence, validateScheduleConfig, type ScheduleConfig } from "./schedule";
import { adaptWebhook, publicWebhookConfig, validateWebhookHandler, type WebhookProvider, type WebhookTriggerConfig } from "./webhook-trigger";
import { reflectTriggerContext } from "./trigger-context";
import { installedTriggerAvailability, sameProviderReference } from "./trigger-availability";
import { clickUpJson, matchingClickUpTask } from "./clickup";

export { DEFAULT_CONTEXT_TEMPLATE, linearTicketPrompt, renderContextTemplate } from "./linear-source";

type Row = Record<string, unknown>;
const json = (value: unknown) => Response.json(value);
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const HERDR_FLOW_NAME = /^[a-z][a-z0-9_-]{0,29}$/;
const JOB_SLUG = /^[a-z][a-z0-9_-]{0,29}$/;

const object = (value: unknown): Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const text = (value: unknown): string => typeof value === "string" ? value : "";
const linearSource = new LinearSourceAdapter();

type FlowSource =
  | { kind: "linear"; projectId: string; matchRules: MatchRule[] }
  | { kind: "github"; installationId: number; repositoryId: number; repositoryOwner?: string; repositoryName?: string; repositoryFullName?: string; baseRef: "main"; trigger: "merge_queue_conflict" }
  | { kind: "custom"; origin: "linear" | "github" | "cloudflare"; handlerName: string; handlerCode: string; handlerDeployment: { scriptName: string; codeDigest: string; state: "deploying" | "ready" | "failed" }; tail?: { signingSecret: string } };
type PipeInput = { pipeId?: string; name: string; flowId?: string; projectId?: string; matchRules: MatchRule[]; maxConcurrency: number; contextTemplate?: string; exeConnectionId?: string; cwd?: string; source?: FlowSource };

export class TenantV2 extends DurableObject<Env> {
  private linearRefresh?: Promise<string>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      ${JOB_SCHEMA}
      CREATE TABLE IF NOT EXISTS connections (kind TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS members (user_id TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL, session_version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS access_tokens (id TEXT PRIMARY KEY, name TEXT NOT NULL, digest TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL, session_version INTEGER NOT NULL, scopes TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT);
      CREATE TABLE IF NOT EXISTS pipes (id TEXT PRIMARY KEY, name TEXT NOT NULL, project_id TEXT NOT NULL, team_id TEXT NOT NULL,
        filter_type TEXT NOT NULL, filter_target_id TEXT NOT NULL, max_concurrency INTEGER NOT NULL, capability TEXT NOT NULL,
        webhook_id TEXT, signing_secret TEXT NOT NULL, workspace_name TEXT NOT NULL DEFAULT '', agent_kind TEXT NOT NULL DEFAULT '', context_template TEXT NOT NULL DEFAULT '', match_rules TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, pipe_id TEXT NOT NULL, received_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS flow_events (id TEXT PRIMARY KEY, flow_id TEXT NOT NULL, delivery_id TEXT NOT NULL, issue_id TEXT,
        issue_url TEXT, event_type TEXT NOT NULL, event_action TEXT NOT NULL, outcome TEXT NOT NULL, detail TEXT NOT NULL, received_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS flow_events_by_flow ON flow_events(flow_id, received_at DESC);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, pipe_id TEXT NOT NULL, issue_id TEXT NOT NULL, agent_name TEXT NOT NULL,
        issue_url TEXT, workspace_name TEXT NOT NULL DEFAULT '', agent_kind TEXT NOT NULL DEFAULT '', state TEXT NOT NULL, prompt TEXT NOT NULL, result TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS active_claims (pipe_id TEXT NOT NULL, issue_id TEXT NOT NULL, run_id TEXT NOT NULL, PRIMARY KEY(pipe_id, issue_id));
      CREATE TABLE IF NOT EXISTS github_installations (installation_id INTEGER PRIMARY KEY, account_login TEXT NOT NULL, account_type TEXT NOT NULL, state TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS github_setup_states (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, used_at TEXT);
      CREATE TABLE IF NOT EXISTS pending_verifications (id TEXT PRIMARY KEY, flow_id TEXT NOT NULL, delivery_id TEXT NOT NULL, installation_id INTEGER NOT NULL, repository_id INTEGER NOT NULL, repository_owner TEXT NOT NULL, repository_name TEXT NOT NULL, pull_number INTEGER NOT NULL, attempt INTEGER NOT NULL, next_attempt_at INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS run_activity (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tail_fingerprints (flow_id TEXT NOT NULL, fingerprint TEXT NOT NULL, window_started INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(flow_id,fingerprint));
    `);
    this.ensureColumn("pipes", "workspace_name", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("triggers", "position", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("pipes", "agent_kind", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("pipes", "context_template", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("pipes", "match_rules", "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn("pipes", "exe_connection_id", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("pipes", "cwd", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("flow_events", "issue_url", "TEXT");
    this.ensureColumn("runs", "issue_url", "TEXT");
    this.ensureColumn("runs", "issue_title", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("runs", "workspace_name", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("runs", "agent_kind", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("runs", "exec_request", "TEXT");
    this.ensureColumn("runs", "exec_response", "TEXT");
    this.ensureColumn("runs", "exec_status", "INTEGER");
    this.ensureColumn("runs", "exec_exit_code", "INTEGER");
    this.ensureColumn("runs", "prompt_delivery_state", "TEXT NOT NULL DEFAULT 'legacy'");
    this.ensureColumn("runs", "prompt_delivery_request", "TEXT");
    this.ensureColumn("runs", "prompt_delivery_response", "TEXT");
    this.ensureColumn("runs", "prompt_delivery_status", "INTEGER");
    this.ensureColumn("runs", "prompt_delivery_exit_code", "INTEGER");
    this.ensureColumn("pipes", "source_kind", "TEXT NOT NULL DEFAULT 'linear'");
    this.ensureColumn("pipes", "source_config", "TEXT NOT NULL DEFAULT '{}'");
    this.ensureColumn("pipes", "trigger_kind", "TEXT NOT NULL DEFAULT 'linear_match'");
    this.ensureColumn("pipes", "trigger_config", "TEXT NOT NULL DEFAULT '{}'");
    this.ensureColumn("flow_events", "provider", "TEXT NOT NULL DEFAULT 'linear'");
    this.ensureColumn("runs", "provider", "TEXT NOT NULL DEFAULT 'linear'");
    this.ensureColumn("runs", "claim_key", "TEXT");
    this.ensureColumn("runs", "execution_backend_kind", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("runs", "execution_handle", "TEXT");
    this.ensureColumn("runs", "execution_capabilities", "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn("runs", "destination_url", "TEXT");
    for (const [column, definition] of Object.entries({ herdr_server_namespace: "TEXT NOT NULL DEFAULT 'default'", worktree_path: "TEXT", ownership_lease: "TEXT", ownership_generation: "INTEGER NOT NULL DEFAULT 0", agent_session_generation: "INTEGER NOT NULL DEFAULT 0", output_captured: "INTEGER NOT NULL DEFAULT 0", claim_released: "INTEGER NOT NULL DEFAULT 0", pane_collected: "INTEGER NOT NULL DEFAULT 0", pane_collection_attempt: "INTEGER NOT NULL DEFAULT 0", pane_collection_next_at: "INTEGER", worktree_disposition: "TEXT" })) this.ensureColumn("runs", column, definition);
    for (const [column, definition] of Object.entries({ herdr_workspace_id: "TEXT", herdr_pane_id: "TEXT", herdr_terminal_id: "TEXT", agent_session_source: "TEXT", agent_session_kind: "TEXT", agent_session_value: "TEXT", herdr_cwd: "TEXT", last_agent_status: "TEXT", recovery_attempt: "INTEGER NOT NULL DEFAULT 0", recovery_reason: "TEXT", recovery_started_at: "TEXT", recovery_last_action: "TEXT", recovery_next_at: "INTEGER", recovery_comment_started: "INTEGER NOT NULL DEFAULT 0", recovery_comment_finished: "INTEGER NOT NULL DEFAULT 0", prompt_accepted: "INTEGER NOT NULL DEFAULT 0", recovery_prompt_attempted: "INTEGER NOT NULL DEFAULT 0", recovery_prompt_accepted: "INTEGER NOT NULL DEFAULT 0" })) this.ensureColumn("runs", column, definition);
    this.ensureColumn("triggers", "slug", "TEXT");
    this.ensureColumn("jobs", "slug", "TEXT");
    for (const job of this.rows("SELECT id,name,slug FROM jobs ORDER BY created_at,id")) {
      if (job.slug) continue;
      const base = workspaceNameFor(String(job.name)).slice(0, 30);
      let candidate = base, suffix = 2;
      while (this.one("SELECT id FROM jobs WHERE slug=?", candidate)) candidate = `${base.slice(0, 30 - String(suffix).length - 1)}-${suffix++}`;
      this.ctx.storage.sql.exec("UPDATE jobs SET slug=? WHERE id=?", candidate, job.id);
    }
    this.ctx.storage.sql.exec("CREATE UNIQUE INDEX IF NOT EXISTS jobs_slug_unique ON jobs(slug)");
    this.ensureColumn("invocations", "trigger_id", "TEXT");
    for (const job of this.rows("SELECT id FROM jobs")) {
      let index = 1;
      for (const trigger of this.rows("SELECT id,slug FROM triggers WHERE job_id=? ORDER BY created_at,id", job.id)) {
        if (!trigger.slug) this.ctx.storage.sql.exec("UPDATE triggers SET slug=? WHERE id=?", `trigger-${index}`, trigger.id);
        index++;
      }
    }
    this.migrateSingularJobTriggers();
    this.migrateStructuredTriggerContext();
  }

  /** Rebuild v1 Job tables because SQLite cannot drop UNIQUE/CHECK constraints in place. */
  private migrateSingularJobTriggers(): void {
    const table = this.one("SELECT sql FROM sqlite_master WHERE type='table' AND name='triggers'") as Row | undefined;
    if (!String(table?.sql ?? "").includes("job_id TEXT NOT NULL UNIQUE")) return;
    this.ctx.storage.sql.exec(`
      DROP TABLE IF EXISTS lifecycle_deliveries;
      DROP TABLE IF EXISTS automatic_wakes;
      ALTER TABLE schedule_state RENAME TO schedule_state_v1;
      ALTER TABLE job_runs RENAME TO job_runs_v1;
      ALTER TABLE invocations RENAME TO invocations_v1;
      ALTER TABLE triggers RENAME TO triggers_v1;
      ${JOB_SCHEMA}
      INSERT INTO triggers(id,job_id,kind,slug,enabled,config,created_at,updated_at)
        SELECT id,job_id,kind,'trigger-1',1,config,created_at,updated_at FROM triggers_v1 WHERE kind IN ('schedule','webhook');
      INSERT INTO triggers(id,job_id,kind,slug,enabled,config,created_at,updated_at)
        SELECT lower(hex(randomblob(16))),j.id,'manual','trigger-2',1,'{}',j.created_at,j.updated_at FROM jobs j;
      INSERT INTO invocations(id,job_id,source,claim_key,trigger_id,context,occurrence,created_at)
        SELECT i.id,i.job_id,i.source,i.claim_key,t.id,json_object(t.slug,json_object('legacy_context',COALESCE(i.context,''),'legacy_parameters',i.parameters)),i.occurrence,i.created_at FROM invocations_v1 i JOIN triggers t ON t.job_id=i.job_id AND (t.kind=i.source OR (i.source NOT IN ('manual','schedule','webhook') AND t.kind='manual'));
      INSERT INTO job_runs(id,job_id,invocation_id,state,encrypted_prompt,created_at,updated_at,started_at)
        SELECT id,job_id,invocation_id,CASE state WHEN 'cancelled' THEN 'stopped' ELSE state END,encrypted_prompt,created_at,updated_at,started_at FROM job_runs_v1;
      INSERT INTO schedule_state(trigger_id,job_id,next_run_at,last_triggered_at)
        SELECT s.trigger_id,s.job_id,s.next_run_at,s.last_triggered_at FROM schedule_state_v1 s JOIN triggers t ON t.id=s.trigger_id;
      DROP TABLE schedule_state_v1;
      DROP TABLE job_runs_v1;
      DROP TABLE invocations_v1;
      DROP TABLE triggers_v1;
      CREATE INDEX IF NOT EXISTS job_runs_queue ON job_runs(state, created_at);
      CREATE INDEX IF NOT EXISTS job_runs_active ON job_runs(job_id, state);
      CREATE INDEX IF NOT EXISTS schedules_due ON schedule_state(next_run_at);
    `);
  }

  /** Upgrade parameter-era Job rows to the trigger-keyed structured context contract. */
  private migrateStructuredTriggerContext(): void {
    const table = this.one("SELECT sql FROM sqlite_master WHERE type='table' AND name='triggers'") as Row | undefined;
    if (String(table?.sql ?? "").includes("'manual'")) return;
    this.ctx.storage.sql.exec(`
      DROP TABLE IF EXISTS lifecycle_deliveries;
      DROP TABLE IF EXISTS automatic_wakes;
      ALTER TABLE schedule_state RENAME TO schedule_state_parameters;
      ALTER TABLE job_runs RENAME TO job_runs_parameters;
      ALTER TABLE invocations RENAME TO invocations_parameters;
      ALTER TABLE triggers RENAME TO triggers_parameters;
      ${JOB_SCHEMA}
      INSERT INTO triggers(id,job_id,kind,slug,enabled,config,created_at,updated_at)
        SELECT id,job_id,kind,COALESCE(slug,'trigger-' || row_number() OVER (PARTITION BY job_id ORDER BY created_at,id)),enabled,config,created_at,updated_at FROM triggers_parameters;
      INSERT INTO triggers(id,job_id,kind,slug,enabled,config,created_at,updated_at)
        SELECT lower(hex(randomblob(16))),j.id,'manual','trigger-' || (1 + (SELECT count(*) FROM triggers t WHERE t.job_id=j.id)),1,'{}',j.created_at,j.updated_at FROM jobs j;
      INSERT INTO invocations(id,job_id,source,claim_key,trigger_id,context,occurrence,created_at)
        SELECT i.id,i.job_id,i.source,i.claim_key,COALESCE(i.trigger_id,t.id),json_object(COALESCE(t.slug,'trigger-1'),json_object('legacy_context',COALESCE(i.context,''),'legacy_parameters',i.parameters)),i.occurrence,i.created_at
        FROM invocations_parameters i LEFT JOIN triggers t ON t.job_id=i.job_id AND t.kind=i.source;
      INSERT INTO job_runs SELECT * FROM job_runs_parameters;
      INSERT INTO schedule_state SELECT * FROM schedule_state_parameters;
      DROP TABLE schedule_state_parameters;
      DROP TABLE job_runs_parameters;
      DROP TABLE invocations_parameters;
      DROP TABLE triggers_parameters;
    `);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/v1/runs") return this.listRuns(url);
      if (request.method === "GET" && /^\/v1\/runs\/[^/]+$/.test(url.pathname)) return await this.getRun(decodeURIComponent(url.pathname.split("/")[3] ?? ""));
      if (request.method === "POST" && /^\/v1\/runs\/[^/]+\/stop$/.test(url.pathname)) return await this.stopRun(decodeURIComponent(url.pathname.split("/")[3] ?? ""));
      if (request.method === "GET" && url.pathname === "/v1/execution-targets") return await this.executionTargets();
      if (request.method === "GET" && url.pathname === "/v1/job-trigger-availability") return await this.triggerAvailability();
      if (request.method === "GET" && url.pathname === "/v1/jobs") return json(await Promise.all(this.rows("SELECT * FROM jobs ORDER BY created_at DESC").map(row => this.publicJob(row))));
      if (request.method === "POST" && url.pathname === "/v1/jobs") return await this.createJob(await request.json());
      const invocationMatch = url.pathname.match(/^\/v1\/jobs\/([^/]+)\/invocations$/);
      if (request.method === "POST" && invocationMatch) return await this.invokeJob(decodeURIComponent(invocationMatch[1]), await request.json());
      const enabledMatch = url.pathname.match(/^\/v1\/jobs\/([^/]+)\/(enable|disable)$/);
      if (request.method === "POST" && enabledMatch) return this.setJobEnabled(decodeURIComponent(enabledMatch[1]), enabledMatch[2] === "enable");
      const jobMatch = url.pathname.match(/^\/v1\/jobs\/([^/]+)$/);
      if (request.method === "GET" && jobMatch) return await this.getJobV1(decodeURIComponent(jobMatch[1]));
      if (request.method === "PUT" && jobMatch) return await this.updateJob(decodeURIComponent(jobMatch[1]), await request.json());
      if (request.method === "DELETE" && jobMatch) return this.deleteJob(decodeURIComponent(jobMatch[1]));
      const jobEventsMatch = url.pathname.match(/^\/v1\/jobs\/([^/]+)\/events$/);
      if (request.method === "GET" && jobEventsMatch) return this.listJobEvents(decodeURIComponent(jobEventsMatch[1]), url);
      if (request.method === "POST" && url.pathname === "/v1/job-handlers/test") return await this.testJobHandler(await request.json());
      if (request.method === "GET" && url.pathname === "/connections/status") return await this.connectionStatus();
      if (request.method === "POST" && url.pathname === "/members") return await this.upsertMember(await request.json());
      if (request.method === "GET" && url.pathname.startsWith("/members/")) return this.getMember(url.pathname.split("/")[2] ?? "");
      if (request.method === "POST" && url.pathname.startsWith("/members/") && url.pathname.endsWith("/revoke")) return this.revokeMember(url.pathname.split("/")[2] ?? "");
      if (request.method === "GET" && url.pathname === "/access-tokens") return json(this.rows("SELECT id,name,scopes,created_at,expires_at,last_used_at,revoked_at FROM access_tokens ORDER BY created_at DESC").map(row => ({ ...row, scopes: JSON.parse(String(row.scopes)) })));
      if (request.method === "POST" && url.pathname === "/access-tokens") return this.createAccessToken(await request.json());
      if (request.method === "POST" && url.pathname === "/access-tokens/authenticate") return this.authenticateAccessToken(await request.json());
      const tokenActive = url.pathname.match(/^\/access-tokens\/([^/]+)\/active$/);
      if (request.method === "GET" && tokenActive) return this.activeAccessToken(decodeURIComponent(tokenActive[1]));
      const accessToken = url.pathname.match(/^\/access-tokens\/([^/]+)$/);
      if (request.method === "DELETE" && accessToken) return this.revokeAccessToken(decodeURIComponent(accessToken[1]));
      if (request.method === "GET" && url.pathname === "/linear/projects") return await this.linearProjects();
      if (request.method === "GET" && url.pathname === "/linear/options") return await this.linearOptions();
      if (request.method === "GET" && url.pathname === "/clickup/lists") return await this.clickUpLists();
      if (request.method === "GET" && url.pathname === "/clickup/options") return await this.clickUpOptions(url.searchParams.get("listId"));
      if (request.method === "PUT" && url.pathname === "/connections/linear") return await this.saveLinear(await request.json());
      if (request.method === "PUT" && url.pathname === "/connections/clickup") return await this.saveClickUp(await request.json());
      if (request.method === "PUT" && url.pathname === "/connections/exe") return await this.saveExe(await request.json());
      if (request.method === "POST" && url.pathname === "/connections/exe/test") return await this.testExe(await request.json());
      if (request.method === "PUT" && url.pathname === "/connections/amp") return await this.saveAmp(await request.json());
      if (request.method === "POST" && url.pathname === "/connections/amp/test") return await this.testAmp(await request.json());
      if (request.method === "GET" && url.pathname === "/connections/cloudflare-tail") return json(await this.tailIntegrationStatus());
      if (request.method === "POST" && url.pathname === "/connections/cloudflare-tail") return await this.saveTailIntegration(await request.json());
      const tailConnectionMatch = url.pathname.match(/^\/connections\/cloudflare-tail\/([^/]+)$/);
      if (request.method === "PUT" && tailConnectionMatch) return await this.saveTailIntegration({ ...await request.json() as object, integrationId: decodeURIComponent(tailConnectionMatch[1]) });
      if (request.method === "DELETE" && tailConnectionMatch) return this.disconnectTailIntegration(decodeURIComponent(tailConnectionMatch[1]));
      const tailTestMatch = url.pathname.match(/^\/connections\/cloudflare-tail\/([^/]+)\/test$/);
      if (request.method === "POST" && tailTestMatch) return await this.testTailIntegration(decodeURIComponent(tailTestMatch[1]));
      if (request.method === "POST" && url.pathname === "/webhook/linear") return await this.acceptLinearWebhook(await request.json() as Record<string, any>, request.headers.get("linear-delivery"));
      if (request.method === "POST" && url.pathname === "/webhook/clickup") { const raw = await request.text(); return await this.acceptClickUpWebhook(raw, request.headers.get("X-Signature")); }
      if (request.method === "POST" && url.pathname === "/webhook/github") return await this.acceptGitHubWebhook(await request.json() as Record<string, any>, request.headers.get("github-delivery"), request.headers.get("github-event"));
      const tailMatch = url.pathname.match(/^\/webhook\/cloudflare\/([^/]+)$/);
      if (request.method === "POST" && tailMatch) return await this.acceptCloudflareTail(decodeURIComponent(tailMatch[1]), await request.text(), request.headers);
      if (request.method === "GET" && url.pathname === "/github/installations") return this.githubInstallations();
      if (request.method === "PUT" && url.pathname === "/github/installations") return this.saveGitHubInstallation(await request.json());
      if (request.method === "POST" && url.pathname === "/github/setup-state") return this.saveSetupState(await request.json());
      if (request.method === "POST" && url.pathname === "/github/setup-state/consume") return this.consumeSetupState(await request.json());
      const repoMatch = url.pathname.match(/^\/github\/installations\/(\d+)\/repositories$/);
      if (request.method === "GET" && repoMatch) return await this.githubRepositories(Number(repoMatch[1]));
      const stateMatch = url.pathname.match(/^\/github\/installations\/(\d+)\/state$/);
      if (request.method === "PATCH" && stateMatch) return this.updateGitHubInstallation(Number(stateMatch[1]), await request.json());
      const installMatch = url.pathname.match(/^\/github\/installations\/(\d+)$/);
      if (request.method === "DELETE" && installMatch) return this.updateGitHubInstallation(Number(installMatch[1]), { state: "removed" });
      return new Response("Not found", { status: 404 });
    } catch (error) {
      console.error(JSON.stringify({ event: "factorize_unexpected_failure", component: "tenant", path: url.pathname, message: error instanceof Error ? error.message : "Unknown error", factorizeTailSuppressed: url.pathname.startsWith("/webhook/cloudflare/") }));
      return Response.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 400 });
    }
  }

  async alarm(): Promise<void> {
    await this.processGitHubVerifications();
    await this.processDueSchedules();
    const panes = this.rows("SELECT * FROM runs WHERE state IN ('done','failed','cancelled') AND output_captured=1 AND claim_released=1 AND pane_collected=0 AND pane_collection_attempt<8 AND COALESCE(pane_collection_next_at,0)<=? ORDER BY updated_at LIMIT 20", Date.now());
    for (const run of panes) await this.collectRunPane(run);
    // Release completed slots before looking at the queue, so capacity is used
    // immediately rather than waiting for the next polling alarm.
    const running = this.rows("SELECT * FROM runs WHERE pipe_id IN (SELECT id FROM jobs) AND state IN ('starting','running','blocked','recovering') ORDER BY updated_at LIMIT 40");
    for (const run of running) await this.pollRun(run);
    const queued = this.rows("SELECT * FROM runs WHERE pipe_id IN (SELECT id FROM jobs) AND state = 'queued' ORDER BY created_at LIMIT 20");
    for (const run of queued) {
      const pipe = this.executionConfig(run.pipe_id);
      if (!pipe) continue;
      const active = this.one("SELECT count(*) AS count FROM runs WHERE pipe_id = ? AND state IN ('starting','running','blocked','recovering')", pipe.id) as Row;
      if (Number(active.count) >= Number(pipe.max_concurrency)) continue;
      const name = `${String(pipe.workspace_name).slice(0, 20)}-${String(run.id).replaceAll("-", "").slice(0, 8)}`;
      this.ctx.storage.sql.exec("UPDATE runs SET state = 'starting', agent_name = ?, workspace_name = ?, updated_at = ? WHERE id = ? AND state = 'queued'", name, pipe.workspace_name, now(), run.id);
      this.ctx.storage.sql.exec("UPDATE job_runs SET state='running',started_at=?,updated_at=? WHERE id=? AND state='queued'", now(), now(), run.id);
      await this.startRun({ ...run, agent_name: name, workspace_name: pipe.workspace_name }, pipe);
    }

    const pending = this.one("SELECT count(*) AS count FROM runs WHERE pipe_id IN (SELECT id FROM jobs) AND state IN ('queued','starting','running','blocked','recovering')") as Row;
    const verification = this.one("SELECT min(next_attempt_at) AS next_attempt_at FROM pending_verifications") as Row;
    const nextVerification = Number(verification?.next_attempt_at || 0);
    const schedule = this.one("SELECT min(next_run_at) AS next_run_at FROM schedule_state") as Row;
    const collection = this.one("SELECT min(pane_collection_next_at) AS next_at FROM runs WHERE pane_collected=0 AND pane_collection_attempt<8 AND pane_collection_next_at IS NOT NULL") as Row;
    const candidates = [Number(pending.count) > 0 ? Date.now() + 15_000 : 0, nextVerification, Number(schedule?.next_run_at || 0), Number(collection?.next_at || 0)].filter(Boolean);
    if (candidates.length) await this.ctx.storage.setAlarm(Math.min(...candidates));
  }

  private async saveLinear(input: unknown): Promise<Response> {
    const value = input as { accessToken?: string; refreshToken?: string; organizationId?: string; organizationName?: string; viewerId?: string; viewerEmail?: string };
    if (!value.accessToken || !value.refreshToken || !value.organizationId) throw new Error("Linear tokens and organization are required");
    await this.putConnection("linear", value);
    return json({ ok: true });
  }

  private async saveClickUp(input: unknown): Promise<Response> {
    const value = input as { accessToken?: string; teamId?: string; teamName?: string; webhookId?: string; webhookSecret?: string };
    if (!value.accessToken || !value.teamId || !value.webhookId || !value.webhookSecret) throw new Error("ClickUp token, workspace, and webhook are required");
    const prior = await this.connection<{ accessToken: string; webhookId?: string }>("clickup");
    if (prior?.webhookId && prior.webhookId !== value.webhookId) await fetch(`https://api.clickup.com/api/v2/webhook/${encodeURIComponent(prior.webhookId)}`, { method: "DELETE", headers: { Authorization: prior.accessToken } }).catch(() => undefined);
    await this.putConnection("clickup", value);
    return json({ ok: true });
  }

  private async saveExe(input: unknown): Promise<Response> {
    const value = input as ExeConnectionInput;
    if (!value.vmName || !value.apiToken || !value.cwd || !value.agentKind) throw new Error("SSH destination, API token, agent, and working directory are required");
    const verification = await exec(value, herdrCheckCommand(value));
    if (verification.status === 403 && verification.body.includes("command not allowed by token permissions")) {
      throw new Error(`This token cannot run ssh commands on ${value.vmName}. Create an exe.dev API token with --cmds="'ssh ${value.vmName}'" (not --vm), then paste the new exe1 token.`);
    }
    if (!verification.ok) throw new Error(`exe.dev/Herdr verification failed (${verification.status}): ${verification.body.slice(0, 300)}`);
    const connectionId = value.connectionId || id();
    await this.putConnection(`exe:${connectionId}`, value);
    // Preserve the most recently saved connection for existing flows created
    // before connections were selectable.
    await this.putConnection("exe", value);
    return json({ ok: true, connectionId, verification: verification.body });
  }

  private async testExe(input: unknown): Promise<Response> {
    const supplied = input as Partial<ExeConnectionInput>;
    const saved = supplied.connectionId ? await this.exeConnection(supplied.connectionId) : await this.connection<ExeConnection>("exe");
    const connection = supplied.vmName || supplied.apiToken || supplied.cwd ? supplied as ExeConnection : saved;
    if (!connection?.vmName || !connection.apiToken) throw new Error("SSH destination and API token are required");
    const result = await exec(connection, connectionCheckCommand());
    return json({ ok: result.ok && (result.exitCode === null || result.exitCode === 0), httpStatus: result.status, exitCode: result.exitCode, command: result.requestBody, output: result.body });
  }

  private async saveAmp(input: unknown): Promise<Response> {
    const value = input as AmpConnectionInput;
    if (!value.accessToken || !value.project) throw new Error("Amp access token and project are required");
    if (!await new AmpBackend(value).test()) throw new Error("Amp connection verification failed");
    const connectionId = value.connectionId || id();
    await this.putConnection(`amp:${connectionId}`, value);
    return json({ ok: true, connectionId });
  }

  private async testAmp(input: unknown): Promise<Response> {
    const supplied = input as Partial<AmpConnectionInput>;
    const saved = supplied.connectionId ? await this.connection<AmpConnection>(`amp:${supplied.connectionId}`) : null;
    const connection = supplied.accessToken ? supplied as AmpConnection : saved;
    if (!connection?.accessToken || !connection.project) throw new Error("Amp access token and project are required");
    return json({ ok: await new AmpBackend(connection).test() });
  }

  private async tailIntegrations(): Promise<Array<{ integrationId: string; name: string; signingSecret: string; createdAt: string; updatedAt: string }>> {
    const rows = this.rows("SELECT kind,value FROM connections WHERE kind LIKE 'cloudflare-tail:%' ORDER BY updated_at DESC");
    return Promise.all(rows.map(async row => ({ ...(JSON.parse(await decrypt(String(row.value), this.env.CREDENTIAL_ENCRYPTION_KEY)) as any), integrationId: String(row.kind).slice(16) })));
  }

  private async tailIntegrationStatus(): Promise<Array<Record<string, unknown>>> {
    const installations = await this.tailIntegrations();
    return installations.map(({ signingSecret: _secret, ...installation }) => ({ ...installation, status: "connected", secretConfigured: true,
      referencedJobCount: Number((this.one("SELECT count(DISTINCT job_id) AS count FROM triggers WHERE kind='webhook' AND json_extract(config,'$.provider')='cloudflareTail' AND json_extract(config,'$.integrationId')=?", installation.integrationId) as Row)?.count ?? 0) }));
  }

  private async saveTailIntegration(input: unknown): Promise<Response> {
    const value = input as TailIntegrationInput;
    const name = String(value.name ?? "").trim();
    if (!name || name.length > 120) throw new Error("A Tail installation name is required");
    const existing = value.integrationId ? await this.connection<any>(`cloudflare-tail:${value.integrationId}`) : null;
    const supplied = String(value.signingSecret ?? "");
    if (supplied && supplied.length < 16) throw new Error("Tail signing secrets must be at least 16 characters");
    const signingSecret = supplied || (value.generateSecret ? generateTailSecret() : existing?.signingSecret);
    if (!signingSecret) throw new Error("Paste a signing secret or request a generated secret");
    const integrationId = value.integrationId || id(), timestamp = now();
    await this.putConnection(`cloudflare-tail:${integrationId}`, { name, signingSecret, createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp });
    return Response.json({ integrationId, name, status: "connected", secretConfigured: true, ...(value.generateSecret ? { generatedSecret: signingSecret } : {}) }, { status: existing ? 200 : 201 });
  }

  private disconnectTailIntegration(integrationId: string): Response {
    const result = this.ctx.storage.sql.exec("DELETE FROM connections WHERE kind=?", `cloudflare-tail:${integrationId}`);
    return Number(result.rowsWritten) ? new Response(null, { status: 204 }) : new Response("Not found", { status: 404 });
  }

  private async testTailIntegration(integrationId: string): Promise<Response> {
    const installation = await this.connection<{ signingSecret: string }>(`cloudflare-tail:${integrationId}`);
    if (!installation) return new Response("Not found", { status: 404 });
    const timestamp = String(Date.now()), delivery = `test-${id()}`, body = "{}";
    const signature = await signTailDelivery(installation.signingSecret, timestamp, delivery, body);
    return json({ ok: await verifyTailDelivery(installation.signingSecret, timestamp, delivery, body, signature) === "valid" });
  }

  private async createPipe(input: PipeInput): Promise<Response> {
    const source = await this.validateSource(input);
    const rules = source.kind === "linear" ? source.matchRules : [{ type: "status", targetId: source.kind } as MatchRule];
    if (!input.name) throw new Error("Pipe name is required");
    const flowId = this.flowId(input.flowId, input.name);
    // Rules are validated above; legacy columns mirror the first rule.
    const requestedConcurrency = Number(input.maxConcurrency);
    const maxConcurrency = Math.max(0, Math.min(50, Math.floor(Number.isFinite(requestedConcurrency) ? requestedConcurrency : 3)));
    const pipeId = input.pipeId || id();
    const linear = await this.connection<{ accessToken: string }>("linear");
    if (!linear) throw new Error("Connect Linear first");
    const exe = await this.exeConnection(input.exeConnectionId);
    if (!exe) throw new Error("Connect Herdr first");
    const cwd = this.cwdTemplate(input.cwd ?? exe.cwd, flowId);
    const workspaceName = flowId;
    // These legacy fields are retained for compatibility with the v1 Durable Object schema.
    // App-wide webhook verification is performed at the Worker edge before reaching this object.
    this.ctx.storage.sql.exec(
      "INSERT INTO pipes (id,name,project_id,team_id,filter_type,filter_target_id,max_concurrency,capability,webhook_id,signing_secret,workspace_name,agent_kind,context_template,match_rules,exe_connection_id,cwd,source_kind,source_config,trigger_kind,trigger_config,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      pipeId, input.name, source.kind === "linear" ? source.projectId : "", "", rules[0].type, rules[0].targetId, maxConcurrency, "app-webhook", null, "app-webhook", workspaceName, exe.agentKind, source.kind !== "github" ? this.contextTemplate(input.contextTemplate) : "", JSON.stringify(rules), input.exeConnectionId || "default", cwd, source.kind, JSON.stringify(source), source.kind === "github" ? source.trigger : source.kind === "custom" ? "custom_handler" : "linear_match", "{}", now(),
    );
    return Response.json({ id: pipeId }, { status: 201 });
  }

  private async updatePipe(pipeId: string, input: PipeInput): Promise<Response> {
    if (!pipeId || !this.one("SELECT id FROM pipes WHERE id = ?", pipeId)) return new Response("Not found", { status: 404 });
    const source = await this.validateSource(input);
    const rules = source.kind === "linear" ? source.matchRules : [{ type: "status", targetId: source.kind } as MatchRule];
    if (!input.name) throw new Error("Pipe name is required");
    const flowId = this.flowId(input.flowId, input.name);
    const requestedConcurrency = Number(input.maxConcurrency);
    const maxConcurrency = Math.max(0, Math.min(50, Math.floor(Number.isFinite(requestedConcurrency) ? requestedConcurrency : 3)));
    const workspaceName = flowId;
    const exe = await this.exeConnection(input.exeConnectionId);
    if (!exe) throw new Error("Choose an exe.dev connection.");
    const cwd = this.cwdTemplate(input.cwd ?? exe.cwd, flowId);
    this.ctx.storage.sql.exec(
      "UPDATE pipes SET name=?, project_id=?, filter_type=?, filter_target_id=?, max_concurrency=?, workspace_name=?, agent_kind=?, context_template=?, match_rules=?, exe_connection_id=?, cwd=?, source_kind=?, source_config=?, trigger_kind=?, trigger_config=? WHERE id=?",
      input.name, source.kind === "linear" ? source.projectId : "", rules[0].type, rules[0].targetId, maxConcurrency, workspaceName, exe.agentKind, source.kind !== "github" ? this.contextTemplate(input.contextTemplate) : "", JSON.stringify(rules), input.exeConnectionId || "default", cwd, source.kind, JSON.stringify(source), source.kind === "github" ? source.trigger : source.kind === "custom" ? "custom_handler" : "linear_match", "{}", pipeId,
    );
    return json({ id: pipeId, ok: true });
  }

  private async connectionStatus(): Promise<Response> {
    const linear = await this.connection<{ organizationName?: string; viewerEmail?: string }>("linear");
    const clickup = await this.connection<{ teamName?: string }>("clickup");
    const connections = await this.exeConnections();
    const exe = await this.connection<ExeConnectionInput>("exe");
    const ampConnections = await this.ampConnections();
    return json({
      linear: linear ? { organizationName: linear.organizationName ?? null, viewerEmail: linear.viewerEmail ?? null } : null,
      clickup: clickup ? { teamName: clickup.teamName ?? null } : null,
      exe: exe ? { vmName: exe.vmName, agentKind: exe.agentKind, cwd: exe.cwd, herdrCommand: exe.herdrCommand ?? "herdr", agentCommand: exe.agentCommand ?? defaultAgentCommand(exe.agentKind) } : null,
      exeConnections: connections.map(({ apiToken, ...connection }) => connection),
      ampConnections: ampConnections.map(({ accessToken, ...connection }) => connection),
      cloudflareTail: { count: (await this.tailIntegrations()).length, installations: await this.tailIntegrationStatus() },
    });
  }

  private async executionTargets(): Promise<Response> {
    const connections = await this.exeConnections();
    const ampConnections = await this.ampConnections();
    return json([...connections.map(connection => ({
      id: connection.connectionId,
      kind: "exe-herdr",
      name: connection.vmName,
      workspace: connection.vmName,
      cwd: connection.cwd,
      agentKind: connection.agentKind,
      capabilities: ["output", "prompt-delivery", "recovery", "stop"],
    })), ...ampConnections.map(connection => ({ id: `amp:${connection.connectionId}`, kind: "amp", name: `Amp · ${connection.project}`, workspace: connection.project, cwd: "Cloud orb", agentKind: "Amp", capabilities: ["stop"] }))]);
  }

  private triggersFor(jobId: unknown): Row[] { return this.rows("SELECT * FROM triggers WHERE job_id = ? ORDER BY position,created_at,id", jobId); }

  private executionConfig(value: unknown): Row | undefined {
    const job = this.one("SELECT * FROM jobs WHERE id = ? AND enabled=1", value) as Row | undefined;
    if (!job) return undefined;
    let target: Record<string, unknown> = {};
    try { target = JSON.parse(String(job.execution_target)); } catch { return undefined; }
    return { id: job.id, name: job.name, max_concurrency: job.concurrency_limit, workspace_name: job.slug, agent_kind: target.agentKind, cwd: target.cwd, execution_backend_kind: target.backendKind ?? "exe-herdr", execution_connection_id: target.connectionId, exe_connection_id: target.connectionId, enabled: job.enabled };
  }

  private async publicJob(row: Row): Promise<Record<string, unknown>> {
    const triggers = this.triggersFor(row.id);
    let executionTarget: Record<string, unknown> = {};
    try { executionTarget = JSON.parse(String(row.execution_target)); } catch { /* malformed internal state is presented safely */ }
    const activity = this.one("SELECT count(*) AS count,max(received_at) AS last_received_at FROM job_events WHERE job_id=?", row.id) as Row | undefined;
    const runSummary = this.one("SELECT count(*) FILTER (WHERE state='running') AS running_count,(SELECT state FROM job_runs WHERE job_id=? ORDER BY created_at DESC,id DESC LIMIT 1) AS last_run_state FROM job_runs WHERE job_id=?", row.id, row.id) as Row | undefined;
    const publicTriggers = await Promise.all(triggers.map(async trigger => {
      let config: Record<string, unknown> = {};
      try { config = JSON.parse(String(trigger.config)); } catch { /* present malformed state safely */ }
      if (trigger.kind === "webhook") config = publicWebhookConfig(config as WebhookTriggerConfig);
      const runtime = trigger.kind === "schedule" ? this.one("SELECT next_run_at,last_triggered_at FROM schedule_state WHERE trigger_id=?", trigger.id) as Row | undefined : undefined;
      const availability = await this.providerTriggerAvailability(trigger.kind, config);
      return { id: trigger.id, slug: trigger.slug, kind: trigger.kind, enabled: Boolean(trigger.enabled), config, reflection: reflectTriggerContext({ ...trigger, config }), createdAt: trigger.created_at, updatedAt: trigger.updated_at,
        actionRequired: availability.available ? null : availability.reason,
        activity: { count: Number(activity?.count ?? 0), lastReceivedAt: activity?.last_received_at ?? null },
        ...(runtime ? { nextRunAt: runtime.next_run_at == null ? null : new Date(Number(runtime.next_run_at)).toISOString(), lastTriggeredAt: runtime.last_triggered_at ?? null } : {}) };
    }));
    return {
      id: row.id, name: row.name, slug: row.slug,
      promptTemplate: await decrypt(String(row.encrypted_prompt_template), this.env.CREDENTIAL_ENCRYPTION_KEY),
      concurrencyLimit: Number(row.concurrency_limit),
      runningCount: Number(runSummary?.running_count ?? 0),
      maxConcurrency: Number(row.concurrency_limit),
      currentRuns: Number(runSummary?.running_count ?? 0),
      lastRunState: runSummary?.last_run_state ?? null,
      executionTargetId: `${executionTarget.backendKind === "amp" ? "amp:" : ""}${String(executionTarget.connectionId ?? "")}`,
      triggers: publicTriggers,
      enabled: Boolean(row.enabled), createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  private async jobTarget(targetId: unknown): Promise<Record<string, string>> {
    if (typeof targetId !== "string" || !targetId) throw new Error("Execution target is required");
    if (targetId.startsWith("amp:")) {
      const connectionId = targetId.slice(4), target = (await this.ampConnections()).find(item => item.connectionId === connectionId);
      if (!target) throw new Error("Execution target not found");
      return { connectionId, backendKind: "amp", workspace: target.project, cwd: "", agentKind: "Amp" };
    }
    const target = (await this.exeConnections()).find(item => item.connectionId === targetId);
    if (!target) throw new Error("Execution target not found");
    return { connectionId: target.connectionId, backendKind: "exe-herdr", workspace: target.vmName, cwd: target.cwd, agentKind: target.agentKind };
  }

  private validateJobInput(input: any): void {
    if (!input?.name || !input.promptTemplate) throw new Error("Job name and prompt template are required");
    if (!JOB_SLUG.test(String(input.slug ?? ""))) throw new Error("Job slug must start with a lowercase letter and contain only lowercase letters, digits, hyphens, or underscores (30 characters maximum).");
    if (!Array.isArray(input.triggers) || input.triggers.some((trigger: any) => !["manual", "schedule", "webhook", "jobLifecycle"].includes(trigger?.kind))) throw new Error("Job triggers are invalid");
    Mustache.parse(input.promptTemplate);
    for (const trigger of input.triggers) {
      if (trigger.kind === "schedule") validateScheduleConfig(trigger.config);
      if (trigger.kind === "webhook") validateWebhookHandler(trigger.config);
    }
    if (input.triggers.filter((trigger: any) => trigger.kind === "manual").length > 1) throw new Error("Only one Manual trigger can be configured");
    const signatures = input.triggers.map((trigger: any) => `${trigger.kind}:${JSON.stringify(trigger.config ?? {})}`);
    if (new Set(signatures).size !== signatures.length) throw new Error("Duplicate trigger configurations are not allowed");
  }

  private normalizedTriggers(input: any[], existing: Map<string, Row> = new Map()): any[] {
    const triggers = input.some(trigger => trigger.kind === "manual") ? [...input] : [{ kind: "manual", enabled: true, config: {} }, ...input];
    const used = new Set([...existing.values()].map(row => String(row.slug || "")).filter(Boolean));
    let next = 1;
    return triggers.map((trigger, position) => {
      const prior = typeof trigger.id === "string" ? existing.get(trigger.id) : undefined;
      if (prior?.slug) return { ...trigger, slug: String(prior.slug), position };
      while (used.has(`trigger-${next}`)) next++;
      const slug = `trigger-${next++}`; used.add(slug);
      return { ...trigger, slug, position };
    });
  }

  private async providerTriggerAvailability(kind: unknown, config: Record<string, any>): Promise<{ available: boolean; reason: string | null }> {
    if (kind !== "webhook") return { available: true, reason: null };
    if (config.provider === "linear") return await this.connection("linear") ? { available: true, reason: null } : { available: false, reason: "Reconnect Linear to use this trigger." };
    if (config.provider === "clickup") return await this.connection("clickup") ? { available: true, reason: null } : { available: false, reason: "Connect ClickUp to use this trigger." };
    if (config.provider === "github") {
      const installation = this.one("SELECT state FROM github_installations WHERE installation_id=?", Number(config.installationId)) as Row | undefined;
      return installation?.state === "active" ? { available: true, reason: null } : { available: false, reason: "Reconnect this GitHub installation to use this trigger." };
    }
    if (config.provider === "cloudflareTail") return await this.connection(`cloudflare-tail:${config.integrationId}`) ? { available: true, reason: null } : { available: false, reason: "Reconnect this Cloudflare Tail installation to use this trigger." };
    return { available: false, reason: "This webhook provider is no longer supported." };
  }

  private async triggerAvailability(): Promise<Response> {
    const linear = Boolean(await this.connection("linear"));
    const clickup = Boolean(await this.connection("clickup"));
    const githubStates = this.rows("SELECT state FROM github_installations").map(row => String(row.state));
    const cloudflareTail = (await this.tailIntegrations()).length;
    return json(installedTriggerAvailability(linear, clickup, githubStates, cloudflareTail));
  }

  private sameProviderReference(trigger: any, previous?: Row): boolean {
    if (!previous || trigger.kind !== "webhook" || previous.kind !== "webhook") return false;
    let config: Record<string, any>; try { config = JSON.parse(String(previous.config)); } catch { return false; }
    return sameProviderReference(trigger.config ?? {}, config);
  }

  private async validateProviderIntegrations(triggers: any[], existing: Map<string, Row> = new Map()): Promise<void> {
    for (const trigger of triggers) {
      const availability = await this.providerTriggerAvailability(trigger.kind, trigger.config ?? {});
      const previous = typeof trigger.id === "string" ? existing.get(trigger.id) : undefined;
      if (!availability.available && !this.sameProviderReference(trigger, previous)) throw new Error(availability.reason ?? "Choose a connected provider installation");
    }
  }

  private async resetSchedules(jobId: string): Promise<void> {
    const job = this.one("SELECT enabled FROM jobs WHERE id=?", jobId) as Row | undefined;
    const schedules = this.rows("SELECT id,enabled,config FROM triggers WHERE job_id=? AND kind='schedule'", jobId);
    this.ctx.storage.sql.exec("DELETE FROM schedule_state WHERE job_id=? AND trigger_id NOT IN (SELECT id FROM triggers WHERE job_id=? AND kind='schedule')", jobId, jobId);
    for (const trigger of schedules) {
      const config = validateScheduleConfig(JSON.parse(String(trigger.config)));
      const next = Boolean(job?.enabled) && Boolean(trigger.enabled) ? nextOccurrence(config, new Date()).getTime() : null;
      this.ctx.storage.sql.exec("INSERT INTO schedule_state(trigger_id,job_id,next_run_at) VALUES(?,?,?) ON CONFLICT(trigger_id) DO UPDATE SET next_run_at=excluded.next_run_at", trigger.id, jobId, next);
      const alarm = await this.ctx.storage.getAlarm();
      if (next !== null && (alarm === null || next < alarm)) await this.ctx.storage.setAlarm(next);
    }
  }

  private persistedTriggerConfig(trigger: any, previous?: Row): Record<string, unknown> {
    const config = { ...(trigger.config ?? {}) } as WebhookTriggerConfig;
    if (trigger.kind !== "webhook") return config;
    let prior: WebhookTriggerConfig | undefined;
    try { prior = previous ? JSON.parse(String(previous.config)) : undefined; } catch { /* invalid old credentials are not reused */ }
    if (prior?.provider === config.provider) {
      if (!config.signingSecret && prior.signingSecret) config.signingSecret = prior.signingSecret;
      if (!config.secret && prior.secret) config.secret = prior.secret;
    }
    return config;
  }

  private async createJob(input: any): Promise<Response> {
    this.validateJobInput(input);
    if (this.one("SELECT id FROM jobs WHERE slug=?", input.slug)) throw new Error("Job slug is already in use");
    await this.validateProviderIntegrations(input.triggers);
    const target = await this.jobTarget(input.executionTargetId), jobId = id(), timestamp = now();
    const triggers = this.normalizedTriggers(input.triggers);
    this.validateLifecycleGraph(jobId, triggers);
    this.ctx.storage.sql.exec("INSERT INTO jobs (id,name,slug,encrypted_prompt_template,execution_target,concurrency_limit,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)", jobId, input.name, input.slug, await encrypt(input.promptTemplate, this.env.CREDENTIAL_ENCRYPTION_KEY), JSON.stringify(target), input.concurrencyLimit, 1, timestamp, timestamp);
    for (const trigger of triggers) this.ctx.storage.sql.exec("INSERT INTO triggers (id,job_id,kind,slug,enabled,config,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)", trigger.id ?? id(), jobId, trigger.kind, trigger.slug, trigger.enabled === false ? 0 : 1, JSON.stringify(this.persistedTriggerConfig(trigger)), trigger.position, timestamp, timestamp);
    await this.resetSchedules(jobId);
    return json(await this.publicJob(this.one("SELECT * FROM jobs WHERE id = ?", jobId) as Row));
  }

  private async getJobV1(jobId: string): Promise<Response> {
    const row = this.one("SELECT * FROM jobs WHERE id = ?", jobId) as Row | undefined;
    return row ? json(await this.publicJob(row)) : new Response("Not found", { status: 404 });
  }

  private async updateJob(jobId: string, input: any): Promise<Response> {
    if (!this.one("SELECT id FROM jobs WHERE id = ?", jobId)) return new Response("Not found", { status: 404 });
    this.validateJobInput(input);
    if (this.one("SELECT id FROM jobs WHERE slug=? AND id!=?", input.slug, jobId)) throw new Error("Job slug is already in use");
    const existing = new Map(this.triggersFor(jobId).map(trigger => [String(trigger.id), trigger]));
    await this.validateProviderIntegrations(input.triggers, existing);
    const triggers = this.normalizedTriggers(input.triggers, existing);
    this.validateLifecycleGraph(jobId, triggers);
    const target = await this.jobTarget(input.executionTargetId), timestamp = now();
    this.ctx.storage.sql.exec("UPDATE jobs SET name=?,slug=?,encrypted_prompt_template=?,execution_target=?,concurrency_limit=?,updated_at=? WHERE id=?", input.name, input.slug, await encrypt(input.promptTemplate, this.env.CREDENTIAL_ENCRYPTION_KEY), JSON.stringify(target), input.concurrencyLimit, timestamp, jobId);
    const retained = new Set<string>();
    for (const trigger of triggers) {
      const triggerId = typeof trigger.id === "string" && existing.has(trigger.id) ? trigger.id : id(); retained.add(triggerId);
      const config = this.persistedTriggerConfig(trigger, existing.get(triggerId));
      if (existing.has(triggerId)) this.ctx.storage.sql.exec("UPDATE triggers SET kind=?,enabled=?,config=?,position=?,updated_at=? WHERE id=? AND job_id=?", trigger.kind, trigger.enabled === false ? 0 : 1, JSON.stringify(config), trigger.position, timestamp, triggerId, jobId);
      else this.ctx.storage.sql.exec("INSERT INTO triggers (id,job_id,kind,slug,enabled,config,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)", triggerId, jobId, trigger.kind, trigger.slug, trigger.enabled === false ? 0 : 1, JSON.stringify(config), trigger.position, timestamp, timestamp);
    }
    for (const triggerId of existing.keys()) if (!retained.has(triggerId)) this.ctx.storage.sql.exec("DELETE FROM triggers WHERE id=? AND job_id=?", triggerId, jobId);
    await this.resetSchedules(jobId);
    return json(await this.publicJob(this.one("SELECT * FROM jobs WHERE id = ?", jobId) as Row));
  }

  private async setJobEnabled(jobId: string, enabled: boolean): Promise<Response> {
    if (!this.one("SELECT id FROM jobs WHERE id = ?", jobId)) return new Response("Not found", { status: 404 });
    this.ctx.storage.sql.exec("UPDATE jobs SET enabled=?,updated_at=? WHERE id=?", enabled ? 1 : 0, now(), jobId);
    await this.resetSchedules(jobId);
    return json({ id: jobId, enabled });
  }

  private validateLifecycleGraph(jobId: string, proposed: any[]): void {
    const graph = new Map<string, string[]>();
    for (const job of this.rows("SELECT id FROM jobs")) graph.set(String(job.id), []);
    graph.set(jobId, []);
    for (const trigger of this.rows("SELECT job_id,config FROM triggers WHERE kind='jobLifecycle'")) {
      if (String(trigger.job_id) === jobId) continue;
      try { graph.set(String(trigger.job_id), [...(graph.get(String(trigger.job_id)) ?? []), ...JSON.parse(String(trigger.config)).sourceJobIds]); } catch { /* invalid old state cannot add an edge */ }
    }
    const sources = proposed.filter(trigger => trigger.kind === "jobLifecycle").flatMap(trigger => trigger.config.sourceJobIds as string[]);
    if (sources.includes(jobId)) throw new Error("A job cannot subscribe to itself");
    for (const source of sources) if (!graph.has(source)) throw new Error(`Lifecycle source job not found: ${source}`);
    graph.set(jobId, sources);
    const visiting = new Set<string>(), visited = new Set<string>();
    const visit = (node: string): boolean => { if (visiting.has(node)) return true; if (visited.has(node)) return false; visiting.add(node); for (const next of graph.get(node) ?? []) if (visit(next)) return true; visiting.delete(node); visited.add(node); return false; };
    for (const node of graph.keys()) if (visit(node)) throw new Error("Job lifecycle subscriptions cannot contain cycles");
  }

  private deleteJob(jobId: string): Response {
    if (!this.one("SELECT id FROM jobs WHERE id = ?", jobId)) return new Response("Not found", { status: 404 });
    this.ctx.storage.sql.exec("DELETE FROM active_claims WHERE pipe_id = ?", jobId);
    this.ctx.storage.sql.exec("DELETE FROM runs WHERE pipe_id = ?", jobId);
    this.ctx.storage.sql.exec("DELETE FROM jobs WHERE id = ?", jobId);
    return json({ id: jobId, deleted: true });
  }

  private async invokeJob(jobId: string, input: any): Promise<Response> {
    if (typeof input.idempotencyKey === "string" && input.idempotencyKey.trim().startsWith("manual:")) {
      return Response.json({ error: "idempotencyKey must not include the reserved manual: claim-key prefix" }, { status: 400 });
    }
    const job = this.one("SELECT enabled FROM jobs WHERE id=?", jobId) as Row | undefined;
    if (!job) return new Response("Not found", { status: 404 });
    if (!Boolean(job.enabled)) return Response.json({ error: "Job is disabled" }, { status: 409 });
    const trigger = this.one("SELECT id,slug FROM triggers WHERE job_id=? AND kind='manual' AND enabled=1 ORDER BY created_at,id LIMIT 1", jobId) as Row | undefined;
    if (!trigger) return Response.json({ error: "The manual trigger is disabled" }, { status: 409 });
    const result = await this.invokeCanonicalJob(jobId, "manual", String(trigger.id), input.idempotencyKey ? `manual:${input.idempotencyKey}` : `manual:${id()}`, { [String(trigger.slug)]: { prompt: String(input.prompt ?? "") } });
    if (!result) return Response.json({ error: "Job is disabled" }, { status: 409 });
    return json(result);
  }

  /** Single persistence boundary used by manual and every automatic trigger adapter. */
  private async invokeCanonicalJob(jobId: string, source: "manual" | "schedule" | "webhook" | "jobLifecycle", triggerId: string, claimKey: string, context: Record<string, unknown>, occurrence?: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const row = this.one("SELECT * FROM jobs WHERE id = ?", jobId) as Row | undefined;
    if (!row || !Boolean(row.enabled)) return null;
    const existing = this.one("SELECT i.id AS invocation_id,r.id AS run_id,r.state FROM invocations i JOIN job_runs r ON r.invocation_id=i.id WHERE i.job_id=? AND i.claim_key=?", jobId, claimKey) as Row | undefined;
    if (existing) return { invocationId: existing.invocation_id, runId: existing.run_id, state: existing.state, duplicate: true };
    const job = await this.publicJob(row);
    const prompt = renderJobPrompt({ promptTemplate: String(job.promptTemplate) }, context);
    const invocationId = id(), runId = id(), timestamp = now();
    this.ctx.storage.sql.exec("INSERT OR IGNORE INTO invocations (id,job_id,source,claim_key,trigger_id,context,occurrence,created_at) VALUES (?,?,?,?,?,?,?,?)", invocationId, jobId, source, claimKey, triggerId, JSON.stringify(context), occurrence ? JSON.stringify(occurrence) : null, timestamp);
    const winner = this.one("SELECT id FROM invocations WHERE job_id=? AND claim_key=?", jobId, claimKey) as Row;
    if (winner.id !== invocationId) {
      const duplicate = this.one("SELECT id,state FROM job_runs WHERE invocation_id=?", winner.id) as Row;
      return { invocationId: winner.id, runId: duplicate.id, state: duplicate.state, duplicate: true };
    }
    const encryptedPrompt = await encrypt(prompt, this.env.CREDENTIAL_ENCRYPTION_KEY);
    this.ctx.storage.sql.exec("INSERT INTO job_runs (id,job_id,invocation_id,state,encrypted_prompt,created_at,updated_at) VALUES (?,?,?,?,?,?,?)", runId, jobId, invocationId, "queued", encryptedPrompt, timestamp, timestamp);
    let target: Record<string, unknown> = {};
    try { target = JSON.parse(String(row.execution_target)); } catch { /* validated when the job is saved */ }
    const provider = source === "webhook" ? String((occurrence as any)?.metadata?.provider ?? "webhook") : source;
    const backendKind = String(target.backendKind ?? "exe-herdr"), capabilities = backendKind === "amp" ? ["stop"] : ["output", "prompt-delivery", "recovery", "stop"];
    this.ctx.storage.sql.exec("INSERT INTO runs (id,pipe_id,issue_id,issue_title,issue_url,claim_key,agent_name,workspace_name,agent_kind,state,prompt,prompt_delivery_state,provider,execution_backend_kind,execution_capabilities,destination_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", runId, jobId, invocationId, String(row.name), null, claimKey, `factorize-${runId}`, String(target.workspace ?? ""), String(target.agentKind ?? ""), "queued", encryptedPrompt, "pending", provider, backendKind, JSON.stringify(capabilities), backendKind === "amp" ? null : "https://exe.dev/", timestamp, timestamp);
    await this.ctx.storage.setAlarm(Date.now());
    return { invocationId, runId, state: "queued", duplicate: false };
  }

  private async signalAutomaticJob(jobId: string, source: "schedule" | "webhook" | "jobLifecycle", triggerId: string, claimKey: string, context: Record<string, unknown>, occurrence?: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const existing = this.one("SELECT i.id AS invocation_id,r.id AS run_id,r.state FROM invocations i LEFT JOIN job_runs r ON r.invocation_id=i.id WHERE i.job_id=? AND i.claim_key=?", jobId, claimKey) as Row | undefined;
    if (existing) return { invocationId: existing.invocation_id, runId: existing.run_id ?? null, state: existing.state ?? "coalesced", duplicate: true };
    const active = this.one("SELECT id,state FROM job_runs WHERE job_id=? AND state IN ('queued','running') ORDER BY created_at LIMIT 1", jobId) as Row | undefined;
    if (!active) return this.invokeCanonicalJob(jobId, source, triggerId, claimKey, context, occurrence);
    const timestamp = now(), invocationId = id();
    this.ctx.storage.sql.exec("INSERT OR IGNORE INTO invocations (id,job_id,source,claim_key,trigger_id,context,occurrence,created_at) VALUES (?,?,?,?,?,?,?,?)", invocationId, jobId, source, claimKey, triggerId, JSON.stringify(context), occurrence ? JSON.stringify(occurrence) : null, timestamp);
    let summary: any = { counts: {}, latest: {} };
    const prior = this.one("SELECT summary FROM automatic_wakes WHERE job_id=?", jobId) as Row | undefined;
    try { if (prior) summary = JSON.parse(String(prior.summary)); } catch { /* reset malformed summary */ }
    summary.counts[source] = Math.min(1_000_000, Number(summary.counts[source] ?? 0) + 1);
    summary.latest[source] = { claimKey: claimKey.slice(-200), occurredAt: (occurrence as any)?.occurredAt ?? timestamp, externalId: String((occurrence as any)?.externalId ?? "").slice(-200) };
    this.ctx.storage.sql.exec("INSERT INTO automatic_wakes(job_id,trailing,summary,updated_at) VALUES(?,1,?,?) ON CONFLICT(job_id) DO UPDATE SET trailing=1,summary=excluded.summary,updated_at=excluded.updated_at", jobId, JSON.stringify(summary), timestamp);
    return { invocationId, runId: active.id, state: active.state, duplicate: false, coalesced: true };
  }

  private async afterJobTerminal(jobId: string, sourceRunId: string, terminalState: "succeeded" | "failed" | "stopped", transitionedAt = now()): Promise<void> {
    const wake = this.one("SELECT summary FROM automatic_wakes WHERE job_id=? AND trailing=1", jobId) as Row | undefined;
    if (wake) {
      this.ctx.storage.sql.exec("UPDATE automatic_wakes SET trailing=0,summary='{}',updated_at=? WHERE job_id=? AND trailing=1", transitionedAt, jobId);
      const trigger = this.one("SELECT id,slug,kind FROM triggers WHERE job_id=? AND kind!='manual' ORDER BY created_at,id LIMIT 1", jobId) as Row | undefined;
      if (trigger) await this.invokeCanonicalJob(jobId, String(trigger.kind) as any, String(trigger.id), `trailing:${sourceRunId}:${transitionedAt}`, { [String(trigger.slug)]: { coalesced: true, summary: JSON.parse(String(wake.summary)) } }, { occurredAt: transitionedAt, metadata: { coalesced: true } });
    }
    const subscribers = this.rows("SELECT t.id,t.slug,t.job_id,t.config FROM triggers t JOIN jobs j ON j.id=t.job_id WHERE t.kind='jobLifecycle' AND t.enabled=1 AND j.enabled=1");
    for (const trigger of subscribers) {
      let config: any; try { config = JSON.parse(String(trigger.config)); } catch { continue; }
      if (!config.sourceJobIds?.includes(jobId) || !config.states?.includes(terminalState)) continue;
      this.ctx.storage.sql.exec("INSERT OR IGNORE INTO lifecycle_deliveries(trigger_id,source_run_id,terminal_state,created_at) VALUES(?,?,?,?)", trigger.id, sourceRunId, terminalState, transitionedAt);
      const claimed = this.one("SELECT changes() AS count") as Row;
      if (!Number(claimed.count)) continue;
      const destination = `job:${String(trigger.job_id)}`;
      const context = { [String(trigger.slug)]: { source_job_id: jobId, source_run_id: sourceRunId, final_state: terminalState, transitioned_at: transitionedAt, observation_destination: destination } };
      await this.signalAutomaticJob(String(trigger.job_id), "jobLifecycle", String(trigger.id), `lifecycle:${trigger.id}:${sourceRunId}:${terminalState}`, context, { occurredAt: transitionedAt, externalId: sourceRunId, metadata: { triggerId: trigger.id, sourceJobId: jobId, finalState: terminalState, observationDestination: destination } });
    }
  }

  private async processDueSchedules(): Promise<void> {
    const wake = Date.now();
    const due = this.rows("SELECT s.job_id,s.trigger_id,s.next_run_at,t.slug,t.config FROM schedule_state s JOIN jobs j ON j.id=s.job_id JOIN triggers t ON t.id=s.trigger_id WHERE j.enabled=1 AND t.enabled=1 AND t.kind='schedule' AND s.next_run_at<=? ORDER BY s.next_run_at LIMIT 100", wake);
    for (const row of due) {
      const config = validateScheduleConfig(JSON.parse(String(row.config))) as ScheduleConfig;
      const catchUp = catchUpOccurrence(config, new Date(Number(row.next_run_at)), new Date(wake));
      if (!catchUp) continue;
      const occurredAt = catchUp.occurredAt.toISOString();
      await this.enqueueScheduledJob(String(row.job_id), String(row.trigger_id), String(row.slug), occurredAt, config);
      this.ctx.storage.sql.exec("UPDATE schedule_state SET next_run_at=?,last_triggered_at=? WHERE trigger_id=? AND next_run_at=?", catchUp.nextRunAt.getTime(), occurredAt, row.trigger_id, row.next_run_at);
    }
  }

  private async enqueueScheduledJob(jobId: string, triggerId: string, slug: string, occurredAt: string, config: ScheduleConfig): Promise<void> {
    await this.signalAutomaticJob(jobId, "schedule", triggerId, `schedule:${triggerId}:${occurredAt}`, { [slug]: { scheduled_at: occurredAt, cron: config.cron, timezone: config.timezone } }, { occurredAt, metadata: { triggerId } });
  }

  private deletePipe(pipeId: string): Response {
    if (!pipeId || !this.one("SELECT id FROM pipes WHERE id = ?", pipeId)) return new Response("Not found", { status: 404 });
    this.ctx.storage.sql.exec("DELETE FROM active_claims WHERE pipe_id = ?", pipeId);
    this.ctx.storage.sql.exec("DELETE FROM runs WHERE pipe_id = ?", pipeId);
    this.ctx.storage.sql.exec("DELETE FROM flow_events WHERE flow_id = ?", pipeId);
    this.ctx.storage.sql.exec("DELETE FROM pipes WHERE id = ?", pipeId);
    return json({ ok: true });
  }

  private async flowDetail(flowId: string, url: URL): Promise<Response> {
    const flow = this.one("SELECT id, name, project_id, filter_type, filter_target_id, match_rules, source_kind, source_config, trigger_kind, trigger_config, max_concurrency, workspace_name, agent_kind, exe_connection_id, cwd, COALESCE(NULLIF(context_template, ''), ?) AS context_template, enabled, created_at FROM pipes WHERE id = ?", DEFAULT_CONTEXT_TEMPLATE, flowId);
    if (!flow) return new Response("Not found", { status: 404 });
    const view = url.searchParams.get("view") === "events" ? "events" : "runs";
    const page = Math.max(1, Math.min(10000, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1));
    const offset = (page - 1) * 10;
    const events = view === "events" ? this.rows("SELECT id, delivery_id, issue_id, issue_url, event_type, event_action, outcome, detail, provider, received_at FROM flow_events WHERE flow_id = ? ORDER BY received_at DESC, id DESC LIMIT 11 OFFSET ?", flowId, offset) : [];
    const runs = view === "runs" ? this.rows("SELECT id, issue_id, issue_title, issue_url, claim_key, agent_name, workspace_name, agent_kind, state, provider, prompt, prompt_delivery_state, prompt_delivery_request, prompt_delivery_response, prompt_delivery_status, prompt_delivery_exit_code, result, created_at, updated_at, exec_request, exec_response, exec_status, exec_exit_code, recovery_reason, recovery_attempt, recovery_last_action, recovery_started_at FROM runs WHERE pipe_id = ? AND state != 'ignored' ORDER BY created_at DESC, id DESC LIMIT 11 OFFSET ?", flowId, offset) : [];
    await this.backfillRunIssueDetails(runs);
    const hasNext = (view === "events" ? events : runs).length > 10;
    if (events.length > 10) events.pop();
    if (runs.length > 10) runs.pop();
    await Promise.all(runs.map(async (run) => {
      if (run.state !== "ignored" && typeof run.prompt === "string" && run.prompt) run.prompt = await decrypt(run.prompt, this.env.CREDENTIAL_ENCRYPTION_KEY);
      if (typeof run.exec_request === "string" && run.exec_request) run.exec_request = await decrypt(run.exec_request, this.env.CREDENTIAL_ENCRYPTION_KEY);
      if (typeof run.exec_response === "string" && run.exec_response) run.exec_response = await decrypt(run.exec_response, this.env.CREDENTIAL_ENCRYPTION_KEY);
      if (typeof run.prompt_delivery_request === "string" && run.prompt_delivery_request) run.prompt_delivery_request = await decrypt(run.prompt_delivery_request, this.env.CREDENTIAL_ENCRYPTION_KEY);
      if (typeof run.prompt_delivery_response === "string" && run.prompt_delivery_response) run.prompt_delivery_response = await decrypt(run.prompt_delivery_response, this.env.CREDENTIAL_ENCRYPTION_KEY);
      // Duplicate-webhook records predate encrypted results and deliberately retain
      // a plain-text explanation. Only completed/failed agent output is encrypted.
      if (run.state !== "ignored" && typeof run.result === "string" && run.result) run.result = await decrypt(run.result, this.env.CREDENTIAL_ENCRYPTION_KEY);
    }));
    return json({ flow, events, runs, pagination: { page, hasNext } });
  }

  private async backfillRunIssueDetails(runs: Row[]): Promise<void> {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const incomplete = runs.filter((run) => String(run.provider || "linear") === "linear" && (!String(run.issue_title || "").trim() || uuid.test(String(run.issue_id))));
    if (!incomplete.length) return;
    const linear = await this.connection<{ accessToken: string }>("linear");
    if (!linear) return;
    await Promise.all(incomplete.map(async (run) => {
      try {
        const data = await this.linear(linear.accessToken, LINEAR_ISSUE_PROJECT_QUERY, { id: String(run.issue_id) });
        const issue = object(data?.issue);
        const title = text(issue.title).trim();
        const identifier = text(issue.identifier).trim();
        if (title) run.issue_title = title;
        if (identifier) run.issue_id = identifier;
        if (title || identifier) this.ctx.storage.sql.exec("UPDATE runs SET issue_title = ?, issue_id = ? WHERE id = ?", run.issue_title, run.issue_id, run.id);
      } catch {
        // A stale or inaccessible issue should not prevent the runs page loading.
      }
    }));
  }

  private async runDetail(runId: string): Promise<Response> {
    const run = this.one("SELECT runs.*, pipes.name AS flow_name FROM runs JOIN pipes ON pipes.id = runs.pipe_id WHERE runs.id = ?", runId);
    if (!run) return new Response("Not found", { status: 404 });
    await this.backfillRunIssueDetails([run]);
    for (const field of ["prompt", "exec_request", "exec_response", "prompt_delivery_request", "prompt_delivery_response", "result"] as const) {
      if (run.state !== "ignored" && typeof run[field] === "string" && run[field]) run[field] = await decrypt(String(run[field]), this.env.CREDENTIAL_ENCRYPTION_KEY);
    }
    return json(run);
  }

  private getFlow(flowId: string): Response {
    const flow = this.one("SELECT id, name, project_id, match_rules, source_kind, source_config, max_concurrency, workspace_name, agent_kind, exe_connection_id, cwd, COALESCE(NULLIF(context_template, ''), ?) AS context_template, enabled, created_at FROM pipes WHERE id = ?", DEFAULT_CONTEXT_TEMPLATE, flowId);
    return flow ? json(flow) : new Response("Not found", { status: 404 });
  }

  private pageSize(url: URL): number {
    const value = Number(url.searchParams.get("limit") ?? 50);
    return Math.max(1, Math.min(100, Number.isFinite(value) ? Math.floor(value) : 50));
  }

  private cursor(url: URL): { at: string; id: string } | null {
    const value = url.searchParams.get("cursor");
    if (!value) return null;
    try {
      const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
      const parsed = JSON.parse(atob(normalized + "===".slice((normalized.length + 3) % 4))) as { at?: unknown; id?: unknown };
      return typeof parsed.at === "string" && typeof parsed.id === "string" ? { at: parsed.at, id: parsed.id } : null;
    } catch { throw new Error("Invalid cursor"); }
  }

  private nextCursor(row: Row | undefined, atKey: string): string | null {
    if (!row) return null;
    return btoa(JSON.stringify({ at: String(row[atKey]), id: String(row.id) })).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  }

  private executionHandle(run: Row, fallbackKind: string): RunHandle {
    try {
      const parsed = JSON.parse(String(run.execution_handle || ""));
      if (parsed && typeof parsed.backendKind === "string" && typeof parsed.id === "string") return parsed;
    } catch { /* Legacy runs derive the adapter-owned handle once. */ }
    return { backendKind: String(run.execution_backend_kind || fallbackKind), id: String(run.agent_name) };
  }

  private presentExecution(run: Row): void {
    run.state = normalizeExecutionState(run.state);
    run.backend_kind = String(run.backend_kind || "exe-herdr");
    try { run.capabilities = JSON.parse(String(run.capabilities || "[]")); } catch { run.capabilities = []; }
    if (!Array.isArray(run.capabilities) || run.capabilities.length === 0) run.capabilities = ["output", "prompt-delivery", "recovery"];
    run.destination_url = String(run.destination_url || "https://exe.dev/");
  }

  private listRuns(url: URL): Response {
    const limit = this.pageSize(url), cursor = this.cursor(url), jobId = url.searchParams.get("jobId"), state = url.searchParams.get("state"), contextQuery = url.searchParams.get("contextQuery");
    const clauses: string[] = [], selectArgs: unknown[] = [], args: unknown[] = [];
    if (jobId) { clauses.push("r.pipe_id = ?"); args.push(jobId); }
    if (state === "succeeded") { clauses.push("r.state IN ('succeeded','done')"); }
    else if (state === "stopped") { clauses.push("r.state IN ('stopped','cancelled')"); }
    else if (state === "starting") { clauses.push("r.state IN ('starting','recovering')"); }
    else if (state) { clauses.push("r.state = ?"); args.push(state); }
    if (contextQuery) { clauses.push("instr(lower(i.context), lower(?)) > 0"); args.push(contextQuery); selectArgs.push(contextQuery, contextQuery); }
    if (cursor) { clauses.push("(r.created_at < ? OR (r.created_at = ? AND r.id < ?))"); args.push(cursor.at, cursor.at, cursor.id); }
    const excerpt = contextQuery
      ? ", instr(lower(i.context), lower(?)) AS context_match_index, length(i.context) AS context_length, substr(i.context, max(instr(lower(i.context), lower(?)) - 80, 1), 200) AS context_excerpt"
      : ", NULL AS context_excerpt";
    const rows = this.rows(`SELECT r.id, r.pipe_id AS job_id, r.issue_id, r.issue_url, r.agent_name, r.workspace_name, r.agent_kind, r.state, r.provider, r.execution_backend_kind AS backend_kind, r.execution_capabilities AS capabilities, r.destination_url, r.created_at, r.updated_at${excerpt} FROM runs r LEFT JOIN job_runs jr ON jr.id = r.id LEFT JOIN invocations i ON i.id = jr.invocation_id ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY r.created_at DESC, r.id DESC LIMIT ?`, ...selectArgs, ...args, limit + 1);
    const hasMore = rows.length > limit, items = rows.slice(0, limit);
    for (const item of items) {
      if (contextQuery) {
        const matchIndex = Number(item.context_match_index), contextLength = Number(item.context_length), excerptValue = String(item.context_excerpt ?? "");
        const excerptStart = Math.max(matchIndex - 80, 1);
        item.context_excerpt = `${excerptStart > 1 ? "…" : ""}${excerptValue}${excerptStart - 1 + excerptValue.length < contextLength ? "…" : ""}`;
        delete item.context_match_index;
        delete item.context_length;
      }
      this.presentExecution(item);
    }
    return json({ items, nextCursor: hasMore ? this.nextCursor(items.at(-1), "created_at") : null });
  }

  private async getRun(runId: string): Promise<Response> {
    const run = this.one(`SELECT r.id, r.pipe_id AS job_id, r.issue_id, r.issue_url, r.agent_name, r.workspace_name, r.agent_kind, r.state, r.provider, r.execution_backend_kind AS backend_kind, r.execution_capabilities AS capabilities, r.destination_url, r.result, r.exec_status, r.exec_exit_code, r.recovery_last_action, r.created_at, r.updated_at,
      i.id AS invocation_id, i.job_id AS invocation_job_id, i.source AS invocation_source, i.claim_key AS invocation_claim_key, i.trigger_id AS invocation_trigger_id, i.context, i.occurrence AS invocation_occurrence, i.created_at AS invocation_created_at
      FROM runs r LEFT JOIN job_runs jr ON jr.id = r.id LEFT JOIN invocations i ON i.id = jr.invocation_id WHERE r.id = ?`, runId);
    if (!run) return new Response("Not found", { status: 404 });
    if (run.invocation_id) {
      let context: unknown = {}, occurrence: unknown = null;
      try { context = JSON.parse(String(run.context || "{}")); } catch { context = { legacy: String(run.context ?? "") }; }
      try { occurrence = run.invocation_occurrence == null ? null : JSON.parse(String(run.invocation_occurrence)); } catch { /* Persisted invocation remains readable if metadata is malformed. */ }
      run.context = context;
      const claimKey = String(run.invocation_claim_key);
      const invocation: Record<string, unknown> = { id: run.invocation_id, job_id: run.invocation_job_id, source: run.invocation_source, trigger_id: run.invocation_trigger_id, claim_key: claimKey, context, occurrence, created_at: run.invocation_created_at };
      if (run.invocation_source === "manual" && claimKey.startsWith("manual:")) invocation.idempotency_key = claimKey.slice("manual:".length);
      run.invocation = invocation;
    } else {
      run.context = null;
      run.invocation = null;
    }
    for (const key of ["invocation_id", "invocation_job_id", "invocation_source", "invocation_trigger_id", "invocation_claim_key", "invocation_occurrence", "invocation_created_at"]) delete run[key];
    if (run.state !== "ignored" && typeof run.result === "string" && run.result) run.result = await decrypt(run.result, this.env.CREDENTIAL_ENCRYPTION_KEY);
    run.activity = this.rows("SELECT action, detail, created_at FROM run_activity WHERE run_id = ? ORDER BY created_at, id", runId);
    this.presentExecution(run);
    return json(run);
  }

  private listEvents(url: URL): Response {
    const limit = this.pageSize(url), cursor = this.cursor(url), flowId = url.searchParams.get("flowId");
    const clauses: string[] = [], args: unknown[] = [];
    if (flowId) { clauses.push("flow_id = ?"); args.push(flowId); }
    if (cursor) { clauses.push("(received_at < ? OR (received_at = ? AND id < ?))"); args.push(cursor.at, cursor.at, cursor.id); }
    const rows = this.rows(`SELECT id, flow_id, delivery_id, issue_id, issue_url, event_type, event_action, outcome, detail, provider, received_at FROM flow_events ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY received_at DESC, id DESC LIMIT ?`, ...args, limit + 1);
    const hasMore = rows.length > limit, items = rows.slice(0, limit);
    return json({ items, nextCursor: hasMore ? this.nextCursor(items.at(-1), "received_at") : null });
  }

  private async stopRun(runId: string): Promise<Response> {
    const run = this.one("SELECT * FROM runs WHERE id = ?", runId);
    if (!run) return new Response("Not found", { status: 404 });
    if (!["starting", "running", "blocked", "recovering"].includes(String(run.state))) return Response.json({ error: "Run is not active" }, { status: 409 });
    if (["starting", "running", "blocked", "recovering"].includes(String(run.state))) {
      const pipe = this.executionConfig(run.pipe_id);
      if (pipe) {
        if (String(pipe.execution_backend_kind) === "amp") {
          const connection = await this.connection<AmpConnection>(`amp:${String(pipe.execution_connection_id)}`);
          if (!connection) return Response.json({ error: "Amp connection is unavailable" }, { status: 502 });
          const backend = new AmpBackend(connection);
          this.ctx.storage.sql.exec("UPDATE runs SET state='stopping',updated_at=? WHERE id=?", now(), runId);
          const stopped = await backend.stop(this.executionHandle(run, backend.kind));
          if (stopped.state !== "stopped") return Response.json({ error: "Could not stop the Amp run" }, { status: 502 });
        } else {
        const connection = await this.exeConnection(String(pipe.exe_connection_id || "default"));
        if (connection && run.agent_name) {
          const backend = new ExeHerdrBackend(connection);
          this.ctx.storage.sql.exec("UPDATE runs SET state='stopping',updated_at=? WHERE id=?", now(), runId);
          const stopped = await backend.stop(this.executionHandle(run, backend.kind));
          if (stopped.state !== "stopped") return Response.json({ error: "Could not stop the active agent" }, { status: 502 });
        }
        }
      }
    }
    this.ctx.storage.sql.exec("UPDATE runs SET state = 'stopped', result = ?, updated_at = ? WHERE id = ?", await encrypt("Stopped by user", this.env.CREDENTIAL_ENCRYPTION_KEY), now(), runId);
    this.ctx.storage.sql.exec("UPDATE job_runs SET state='stopped',updated_at=? WHERE id=?", now(), runId);
    this.ctx.storage.sql.exec("DELETE FROM active_claims WHERE run_id = ?", runId);
    await this.afterJobTerminal(String(run.pipe_id), runId, "stopped");
    return json({ id: runId, state: "stopped", stopped: true });
  }

  private async linearProjects(): Promise<Response> {
    const linear = await this.connection<{ accessToken: string }>("linear");
    if (!linear) throw new Error("Connect Linear first");
    const data = await this.linear(linear.accessToken, LINEAR_PROJECTS_QUERY, {});
    return json(data.projects.nodes);
  }

  private async linearOptions(): Promise<Response> {
    const linear = await this.connection<{ accessToken: string }>("linear");
    if (!linear) throw new Error("Connect Linear first");
    const [statusData, userData, labelData] = await Promise.all([
      this.linear(linear.accessToken, LINEAR_OPTION_QUERIES.statuses, {}),
      this.linear(linear.accessToken, LINEAR_OPTION_QUERIES.users, {}),
      this.linear(linear.accessToken, LINEAR_OPTION_QUERIES.labels, {}),
    ]);
    return json({ statuses: statusData.workflowStates.nodes, users: userData.users.nodes, labels: labelData.issueLabels.nodes });
  }

  private async clickUpLists(): Promise<Response> {
    const connection = await this.connection<{ accessToken: string; teamId: string }>("clickup");
    if (!connection) throw new Error("Connect ClickUp first");
    const spaces = (await clickUpJson(connection.accessToken, `/team/${connection.teamId}/space?archived=false`)).spaces ?? [];
    const lists: Array<{ id: string; name: string }> = [];
    for (const space of spaces) {
      const [folderData, folderless] = await Promise.all([
        clickUpJson(connection.accessToken, `/space/${space.id}/folder?archived=false`),
        clickUpJson(connection.accessToken, `/space/${space.id}/list?archived=false`),
      ]);
      for (const list of folderless.lists ?? []) lists.push({ id: String(list.id), name: `${space.name} / ${list.name}` });
      for (const folder of folderData.folders ?? []) for (const list of folder.lists ?? []) lists.push({ id: String(list.id), name: `${space.name} / ${folder.name} / ${list.name}` });
    }
    return json(lists);
  }

  private async clickUpOptions(listId: string | null): Promise<Response> {
    const connection = await this.connection<{ accessToken: string; teamId: string }>("clickup");
    if (!connection || !listId) throw new Error("Connect ClickUp and choose a list first");
    const [list, team, tags] = await Promise.all([clickUpJson(connection.accessToken, `/list/${encodeURIComponent(listId)}`), clickUpJson(connection.accessToken, `/team/${connection.teamId}`), clickUpJson(connection.accessToken, `/team/${connection.teamId}/tag`)]);
    return json({ statuses: (list.statuses ?? []).map((x: any) => ({ id: x.status, name: x.status })), users: (team.team?.members ?? []).map((x: any) => ({ id: String(x.user.id), name: x.user.username ?? x.user.email })), labels: (tags.tags ?? []).map((x: any) => ({ id: x.name, name: x.name })) });
  }

  private webhookJobs(provider: WebhookProvider): Array<{ job: Row; triggerId: string; triggerSlug: string; config: WebhookTriggerConfig }> {
    return this.rows("SELECT j.*,t.id AS trigger_id,t.slug AS trigger_slug,t.config AS trigger_config FROM jobs j JOIN triggers t ON t.job_id=j.id WHERE j.enabled=1 AND t.enabled=1 AND t.kind='webhook'")
      .flatMap(job => { try { const config = JSON.parse(String(job.trigger_config)) as WebhookTriggerConfig; return config.provider === provider ? [{ job, triggerId: String(job.trigger_id), triggerSlug: String(job.trigger_slug), config }] : []; } catch { return []; } }) as any;
  }

  private recordJobEvent(jobId: string, provider: string, deliveryId: string, outcome: string, detail: string): void {
    this.ctx.storage.sql.exec("INSERT INTO job_events VALUES (?,?,?,?,?,?)", id(), jobId, provider, deliveryId, outcome, detail, now());
  }

  private async invokeWebhookJobs(provider: WebhookProvider, deliveryId: string, payload: Record<string, any>, eventName?: string): Promise<void> {
    for (const { job, triggerId, triggerSlug, config } of this.webhookJobs(provider) as any[]) {
      const invocation = adaptWebhook(config, provider, deliveryId, payload, eventName);
      if (!invocation) { this.recordJobEvent(String(job.id), provider, deliveryId, "ignored", "Webhook did not match this job trigger."); continue; }
      let triggerContext: Record<string, unknown> = invocation.payload;
      if (config.handlerCode) {
        if (!this.env.CUSTOM_HANDLER_LOADER) { this.recordJobEvent(String(job.id), provider, deliveryId, "platform_error", "Webhook handler platform is unavailable; no run was created."); continue; }
        const decision = await invokeCustomHandler(this.env.CUSTOM_HANDLER_LOADER, config as Required<Pick<WebhookTriggerConfig, "handlerCode">>, payload);
        if (!decision.ok) {
          const detail = decision.category === "timeout" ? "Handler exceeded its execution deadline; no run was created." : decision.category === "invalid_return" ? "Handler must synchronously return true, false, or a JSON-compatible object; no run was created." : "Handler failed closed; no run was created.";
          this.recordJobEvent(String(job.id), provider, deliveryId, decision.category, detail); continue;
        }
        if (decision.decision === false) { this.recordJobEvent(String(job.id), provider, deliveryId, "rejected", "Handler returned false; no run was created."); continue; }
        if (decision.decision !== true) triggerContext = decision.decision;
      }
      const result = await this.signalAutomaticJob(String(job.id), "webhook", triggerId, `webhook:${triggerId}:${invocation.claimKey}`, { [triggerSlug]: triggerContext }, { ...invocation.occurrence, metadata: { ...invocation.occurrence?.metadata, triggerId } });
      this.recordJobEvent(String(job.id), provider, deliveryId, result?.duplicate ? "duplicate" : result ? "accepted" : "ignored", result?.duplicate ? "Webhook occurrence was already claimed." : result ? "Webhook occurrence queued through canonical job invocation." : "Job was unavailable.");
    }
  }

  private async testJobHandler(input: { handlerCode?: unknown; payload?: unknown }): Promise<Response> {
    const config: WebhookTriggerConfig = { provider: "linear", projectId: "handler-test", matchRules: [], handlerCode: typeof input.handlerCode === "string" ? input.handlerCode : undefined };
    validateWebhookHandler(config);
    if (!config.handlerCode) throw new Error("Handler code is required.");
    if (!this.env.CUSTOM_HANDLER_LOADER) return Response.json({ ok: false, category: "platform_error" }, { status: 503 });
    return json(await invokeCustomHandler(this.env.CUSTOM_HANDLER_LOADER, { handlerCode: config.handlerCode }, input.payload));
  }

  private listJobEvents(jobId: string, url: URL): Response {
    if (!this.one("SELECT id FROM jobs WHERE id=?", jobId)) return new Response("Not found", { status: 404 });
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? 50)));
    return json(this.rows("SELECT id,provider,delivery_id AS deliveryId,outcome,detail,received_at AS receivedAt FROM job_events WHERE job_id=? ORDER BY received_at DESC,id DESC LIMIT ?", jobId, limit));
  }

  private async acceptLinearWebhook(event: Record<string, any>, deliveryId: string | null): Promise<Response> {
    if (!deliveryId) return new Response("Missing delivery ID", { status: 400 });
    await this.invokeWebhookJobs("linear", deliveryId, event);
    await this.ctx.storage.setAlarm(Date.now());
    return new Response(null, { status: 200 });
  }

  private async acceptClickUpWebhook(raw: string, signature: string | null): Promise<Response> {
    const connection = await this.connection<{ accessToken: string; webhookId: string; webhookSecret: string }>("clickup");
    if (!connection || !signature || !(await equalHmac(raw, signature, connection.webhookSecret))) return new Response("Invalid signature", { status: 401 });
    let event: Record<string, any>; try { event = JSON.parse(raw); } catch { return new Response("Invalid JSON", { status: 400 }); }
    if (!event.task_id || String(event.webhook_id) !== connection.webhookId) return new Response(null, { status: 202 });
    const relevant = event.event === "taskCreated" || ["taskStatusUpdated", "taskAssigneeUpdated", "taskTagUpdated", "taskMoved"].includes(String(event.event))
      || (event.event === "taskUpdated" && (event.history_items ?? []).some((item: any) => ["status", "assignee", "tags", "list_id", "creator"].includes(String(item.field))));
    if (!relevant) return new Response(null, { status: 202 });
    const task = await clickUpJson(connection.accessToken, `/task/${encodeURIComponent(String(event.task_id))}`);
    const deliveryId = `clickup:${event.webhook_id}:${event.event}:${event.history_items?.[0]?.date ?? event.task_id}`;
    for (const { job, triggerId, triggerSlug, config } of this.webhookJobs("clickup")) {
      const payload = { ...event, task, matches: matchingClickUpTask(task, String(config.listId), config.matchRules ?? []) };
      const invocation = adaptWebhook(config, "clickup", deliveryId, payload, event.event);
      if (!invocation) { this.recordJobEvent(String(job.id), "clickup", deliveryId, "ignored", "Task did not match this job trigger."); continue; }
      const result = await this.signalAutomaticJob(String(job.id), "webhook", triggerId, `webhook:${triggerId}:${invocation.claimKey}`, { [triggerSlug]: invocation.payload }, { ...invocation.occurrence, metadata: { ...invocation.occurrence.metadata, triggerId } });
      this.recordJobEvent(String(job.id), "clickup", deliveryId, result?.duplicate ? "duplicate" : result ? "accepted" : "ignored", result ? "ClickUp task queued through canonical job invocation." : "Job was unavailable.");
    }
    await this.ctx.storage.setAlarm(Date.now());
    return new Response(null, { status: 200 });
  }

  private async acceptGitHubWebhook(event: Record<string, any>, deliveryId: string | null, eventName: string | null): Promise<Response> {
    if (!deliveryId || !eventName) return new Response("Missing delivery metadata", { status: 400 });
    if (eventName !== "pull_request" || event.action !== "dequeued") await this.invokeWebhookJobs("github", deliveryId, event, eventName);
    if (eventName !== "pull_request" || event.action !== "dequeued") { await this.ctx.storage.setAlarm(Date.now()); return new Response(null, { status: 202 }); }
    const installationId = event.installation?.id, repositoryId = event.repository?.id, pull = event.pull_request;
    if (!Number.isSafeInteger(installationId) || !Number.isSafeInteger(repositoryId) || !Number.isSafeInteger(pull?.number)) return new Response(null, { status: 202 });
    for (const { job, config } of this.webhookJobs("github")) {
      if (config.installationId !== installationId || config.repositoryId !== repositoryId || (config.event ?? "pull_request") !== eventName || (config.action ?? "dequeued") !== event.action || pull.state !== "open" || pull.base?.ref !== "main") continue;
      const minimal = { installation: { id: installationId }, repository: { id: repositoryId }, pull_request: { number: pull.number, url: pull.html_url, title: pull.title ?? "", body: pull.body ?? "", base: { ref: pull.base.ref } }, action: event.action };
      this.ctx.storage.sql.exec("INSERT INTO pending_verifications VALUES (?,?,?,?,?,?,?,?,?,?,?)", id(), job.id, deliveryId, installationId, repositoryId, event.repository.owner?.login ?? "", event.repository.name ?? "", pull.number, 0, Date.now(), JSON.stringify(minimal));
      this.recordJobEvent(String(job.id), "github", deliveryId, "candidate", "Candidate received; waiting for GitHub mergeability verification.");
    }
    await this.ctx.storage.setAlarm(Date.now());
    return new Response(null, { status: 202 });
  }

  private async acceptCloudflareTail(jobId: string, raw: string, headers: Headers): Promise<Response> {
      const item = this.webhookJobs("cloudflareTail").find(({ job }) => job.id === jobId);
      if (!item?.config.integrationId) return new Response("Not found", { status: 404 });
      const installation = await this.connection<{ signingSecret: string }>(`cloudflare-tail:${item.config.integrationId}`);
      if (!installation?.signingSecret) { this.recordJobEvent(jobId, "cloudflareTail", headers.get("x-factorize-delivery") ?? "unknown", "disconnected", "Tail installation is unavailable; delivery rejected."); return new Response("Tail installation disconnected", { status: 503 }); }
      const timestamp = headers.get("x-factorize-timestamp") ?? "", delivery = headers.get("x-factorize-delivery") ?? "", signature = headers.get("x-factorize-signature") ?? "";
      if (!timestamp || !delivery || !signature) return new Response("Missing delivery metadata", { status: 400 });
      const verification = await verifyTailDelivery(installation.signingSecret, timestamp, delivery, raw, signature);
      if (verification !== "valid") { this.recordJobEvent(jobId, "cloudflareTail", delivery, verification, "Tail delivery verification failed."); return new Response(verification === "stale" ? "Stale delivery" : "Invalid signature", { status: 401 }); }
      let payload: Record<string, any>; try { payload = sanitizeTailEvent(JSON.parse(raw)) as Record<string, any>; } catch { return new Response("Invalid JSON", { status: 400 }); }
      if (suppressTailEvent(payload)) { this.recordJobEvent(jobId, "cloudflareTail", delivery, "rejected", "Tail delivery was suppressed to prevent an ingestion loop."); return new Response(null, { status: 202 }); }
      await this.invokeWebhookJobs("cloudflareTail", delivery, payload, "tail");
      return new Response(null, { status: 202 });
  }

  private async testCloudflareTail(flowId: string): Promise<Response> {
    const pipe = this.one("SELECT * FROM pipes WHERE id=? AND enabled=1", flowId) as Row | undefined;
    if (!pipe) return new Response("Not found", { status: 404 });
    const source = this.sourceFor(pipe);
    if (source.kind !== "custom" || source.origin !== "cloudflare") return new Response("Not found", { status: 404 });
    const delivery = `test-${id()}`;
    await this.evaluateCustom(pipe, "cloudflare", delivery, { type: "tail", outcome: "exception", scriptName: "factorize-owner-test", event: { request: { method: "GET", url: "https://example.invalid/test" } }, logs: [], exceptions: [{ name: "Error", message: "Factorize Tail test event" }], test: true });
    await this.ctx.storage.setAlarm(Date.now());
    return json({ ok: true, deliveryId: delivery });
  }

  private async queueWorkItem(pipe: Row, deliveryId: string, workItem: WorkItem, plaintextPrompt: string): Promise<void> {
    const pending = this.one("SELECT count(*) AS count FROM runs WHERE pipe_id=? AND state='queued'", pipe.id) as Row;
    if (Number(pending.count) >= 100) {
      this.recordFlowEvent(pipe, deliveryId, workItem.identifier, null, workItem.event as any, "capacity_overflow", "Accepted delivery dropped because this flow already has 100 pending jobs.", workItem.provider);
      return;
    }
    const runId = id();
    try { this.ctx.storage.sql.exec("INSERT INTO active_claims (pipe_id,issue_id,run_id) VALUES (?,?,?)", pipe.id, workItem.claimKey, runId); }
    catch { this.recordFlowEvent(pipe, deliveryId, workItem.identifier, workItem.url, workItem.event as any, "duplicate", "An active or queued run already owns this work item.", workItem.provider); return; }
    const prompt = await encrypt(plaintextPrompt, this.env.CREDENTIAL_ENCRYPTION_KEY);
    this.ctx.storage.sql.exec("INSERT INTO runs (id,pipe_id,issue_id,issue_title,issue_url,claim_key,agent_name,workspace_name,agent_kind,state,prompt,prompt_delivery_state,provider,execution_backend_kind,execution_capabilities,destination_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", runId, pipe.id, workItem.identifier, workItem.title, workItem.url, workItem.claimKey, `factorize-${runId}`, String(pipe.workspace_name ?? ""), String(pipe.agent_kind ?? ""), "queued", prompt, "pending", workItem.provider, "exe-herdr", JSON.stringify(["output", "prompt-delivery", "recovery"]), "https://exe.dev/", now(), now());
    const active = this.one("SELECT count(*) AS count FROM runs WHERE pipe_id=? AND state IN ('starting','running','blocked','recovering')", pipe.id) as Row;
    this.recordFlowEvent(pipe, deliveryId, workItem.identifier, workItem.url, workItem.event as any, Number(active.count) < Number(pipe.max_concurrency) ? "accepted" : "queued_capacity", Number(active.count) < Number(pipe.max_concurrency) ? "Handler accepted delivery; agent queued to start." : "Handler accepted delivery; queued for capacity.", workItem.provider);
  }

  private async evaluateCustom(pipe: Row, origin: "linear" | "github" | "cloudflare", deliveryId: string, payload: Record<string, any>): Promise<void> {
    const source = this.sourceFor(pipe);
    if (source.kind !== "custom" || source.origin !== origin || source.handlerDeployment.state !== "ready") return;
    if (!this.env.CUSTOM_HANDLER_LOADER) {
      this.recordFlowEvent(pipe, deliveryId, deliveryId, null, payload, "handler_error", "Custom handler platform is unavailable.", origin);
      return;
    }
    const result = await invokeCustomHandler(this.env.CUSTOM_HANDLER_LOADER, source, payload);
    if (!result.ok) {
      const detail = result.category === "timeout" ? "Handler exceeded its execution deadline." : result.category === "invalid_return" ? "Handler must return the literal boolean true or false synchronously." : "Handler failed closed without starting a run.";
      this.recordFlowEvent(pipe, deliveryId, deliveryId, null, payload, result.category, detail, origin);
      return;
    }
    if (!result.decision) {
      this.recordFlowEvent(pipe, deliveryId, deliveryId, null, payload, "rejected", "Handler returned false; delivery ignored.", origin);
      return;
    }
    const workItem: WorkItem = { provider: origin, claimKey: deliveryId, identifier: deliveryId, title: source.handlerName, description: "", url: "", event: payload };
    const prompt = Mustache.render(String(pipe.context_template || DEFAULT_CONTEXT_TEMPLATE), payload);
    await this.queueWorkItem(pipe, deliveryId, workItem, prompt);
  }

  private recordFlowEvent(pipe: Row, deliveryId: string, issueId: string | null, issueUrl: string | null, event: Record<string, any>, outcome: string, detail: string, provider = "linear"): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO flow_events (id,flow_id,delivery_id,issue_id,issue_url,event_type,event_action,outcome,detail,provider,received_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      id(), pipe.id, deliveryId, issueId, issueUrl, String(event.type ?? "unknown"), String(event.action ?? "unknown"), outcome, detail, provider, now(),
    );
  }

  private issueUrl(data: Record<string, any>, issueId: string): string {
    const candidate = typeof data.url === "string" ? data.url : typeof data.issue?.url === "string" ? data.issue.url : "";
    return candidate.startsWith("https://linear.app/") ? candidate : `https://linear.app/issue/${encodeURIComponent(issueId)}`;
  }

  private async processGitHubVerifications(): Promise<void> {
    const pending = this.rows("SELECT * FROM pending_verifications WHERE next_attempt_at <= ? ORDER BY next_attempt_at LIMIT 20", Date.now());
    const delays = [0, 5_000, 15_000, 30_000, 60_000];
    for (const verification of pending) {
      const job = this.one("SELECT j.*,t.id AS trigger_id,t.slug AS trigger_slug,t.config AS trigger_config FROM jobs j JOIN triggers t ON t.job_id=j.id WHERE j.id=? AND j.enabled=1 AND t.enabled=1 AND t.kind='webhook' ORDER BY t.created_at LIMIT 1", verification.flow_id) as Row | undefined;
      const target = job;
      if (!target) { this.ctx.storage.sql.exec("DELETE FROM pending_verifications WHERE id=?", verification.id); continue; }
      const installation = this.one("SELECT state FROM github_installations WHERE installation_id=?", verification.installation_id) as Row | undefined;
      if (installation?.state !== "active") { this.finishVerification(verification, target, "verification_failed", "GitHub installation is disconnected.", Boolean(job)); continue; }
      try {
        const token = await installationToken(this.env, Number(verification.installation_id));
        const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(String(verification.repository_owner))}/${encodeURIComponent(String(verification.repository_name))}/pulls/${verification.pull_number}`, { headers: githubHeaders(token) });
        if (response.status === 404) { this.finishVerification(verification, target, "ignored", "Pull request no longer exists or is inaccessible.", Boolean(job)); continue; }
        const rateLimited = response.status === 429 || (response.status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after")));
        if (response.status === 401 || (response.status === 403 && !rateLimited)) { this.finishVerification(verification, target, "verification_failed", `GitHub access failed permanently (${response.status}).`, Boolean(job)); continue; }
        if (!response.ok) { await this.retryVerification(verification, target, delays, `Transient GitHub API failure (${response.status}).`, rateLimited ? Number(response.headers.get("retry-after")) * 1000 : undefined, Boolean(job)); continue; }
        const pull = await response.json() as any;
        if (pull.state !== "open" || pull.base?.ref !== "main") { this.finishVerification(verification, target, "ignored", "Pull request is closed or no longer targets main.", Boolean(job)); continue; }
        if (pull.mergeable === null) { await this.retryVerification(verification, target, delays, "GitHub is still calculating mergeability.", undefined, Boolean(job)); continue; }
        if (pull.mergeable === true) { this.finishVerification(verification, target, "ignored", "GitHub reports that the pull request is mergeable.", Boolean(job)); continue; }
        if (job) {
          const config = JSON.parse(String(job.trigger_config)) as WebhookTriggerConfig;
          const saved = JSON.parse(String(verification.payload));
          const payload = { ...saved, pull_request: { ...saved.pull_request, ...pull } };
          const invocation = adaptWebhook(config, "github", String(verification.delivery_id), payload, "pull_request");
          this.ctx.storage.sql.exec("DELETE FROM pending_verifications WHERE id=?", verification.id);
          if (!invocation) { this.recordJobEvent(String(job.id), "github", String(verification.delivery_id), "ignored", "Job trigger changed while verification was pending."); continue; }
          let triggerContext: Record<string, unknown> = invocation.payload;
          if (config.handlerCode) {
            if (!this.env.CUSTOM_HANDLER_LOADER) { this.recordJobEvent(String(job.id), "github", String(verification.delivery_id), "platform_error", "Webhook handler platform is unavailable; no run was created."); continue; }
            const decision = await invokeCustomHandler(this.env.CUSTOM_HANDLER_LOADER, { handlerCode: config.handlerCode }, payload);
            if (!decision.ok) { this.recordJobEvent(String(job.id), "github", String(verification.delivery_id), decision.category, decision.category === "timeout" ? "Handler exceeded its execution deadline; no run was created." : decision.category === "invalid_return" ? "Handler must synchronously return true, false, or a JSON-compatible object; no run was created." : "Handler failed closed; no run was created."); continue; }
            if (decision.decision === false) { this.recordJobEvent(String(job.id), "github", String(verification.delivery_id), "rejected", "Handler returned false; no run was created."); continue; }
            if (decision.decision !== true) triggerContext = decision.decision;
          }
          const result = await this.signalAutomaticJob(String(job.id), "webhook", String(job.trigger_id), `webhook:${String(job.trigger_id)}:${invocation.claimKey}`, { [String((job as any).trigger_slug)]: triggerContext }, invocation.occurrence);
          this.recordJobEvent(String(job.id), "github", String(verification.delivery_id), result?.duplicate ? "duplicate" : result ? "accepted" : "ignored", result?.duplicate ? "Webhook occurrence was already claimed." : result ? "Verified webhook queued through canonical job invocation." : "Job was unavailable.");
          continue;
        }
      } catch (error) { await this.retryVerification(verification, target, delays, error instanceof Error ? error.message : "GitHub verification failed.", undefined, Boolean(job)); }
    }
  }

  private async retryVerification(verification: Row, pipe: Row, delays: number[], detail: string, overrideDelay?: number, isJob = false): Promise<void> {
    const nextAttempt = Number(verification.attempt) + 1;
    if (nextAttempt >= delays.length) { this.finishVerification(verification, pipe, "verification_failed", `Verification retries exhausted: ${detail}`, isJob); return; }
    const delay = Math.max(delays[nextAttempt]!, Number.isFinite(overrideDelay) ? overrideDelay! : 0);
    this.ctx.storage.sql.exec("UPDATE pending_verifications SET attempt=?,next_attempt_at=? WHERE id=?", nextAttempt, Date.now() + delay, verification.id);
    if (isJob) this.recordJobEvent(String(pipe.id), "github", String(verification.delivery_id), "waiting", detail);
    else this.recordFlowEvent(pipe, String(verification.delivery_id), githubClaimKey(Number(verification.repository_id), Number(verification.pull_number)), null, { type: "pull_request", action: "dequeued" }, "waiting", detail, "github");
  }

  private finishVerification(verification: Row, pipe: Row, outcome: string, detail: string, isJob = false): void {
    this.ctx.storage.sql.exec("DELETE FROM pending_verifications WHERE id=?", verification.id);
    if (isJob) this.recordJobEvent(String(pipe.id), "github", String(verification.delivery_id), outcome, detail);
    else this.recordFlowEvent(pipe, String(verification.delivery_id), githubClaimKey(Number(verification.repository_id), Number(verification.pull_number)), null, { type: "pull_request", action: "dequeued" }, outcome, detail, "github");
  }

  private async startRun(run: Row, pipe: Row): Promise<void> {
    if (String(pipe.execution_backend_kind) === "amp") {
      const connection = await this.connection<AmpConnection>(`amp:${String(pipe.execution_connection_id)}`);
      if (!connection) return this.finishRun(run, "failed", "Amp connection is unavailable.");
      const backend = new AmpBackend(connection), prompt = await decrypt(String(run.prompt), this.env.CREDENTIAL_ENCRYPTION_KEY);
      try {
        const launched = await backend.launch({ runId: String(run.id), prompt });
        this.ctx.storage.sql.exec("UPDATE runs SET state=?,execution_backend_kind=?,execution_handle=?,execution_capabilities=?,destination_url=?,prompt_delivery_state='accepted',prompt_accepted=1,updated_at=? WHERE id=?", launched.observation.state, backend.kind, JSON.stringify(launched.handle), JSON.stringify(launched.capabilities), launched.destinationUrl, now(), run.id);
      } catch (error) { return this.finishRun(run, "failed", error instanceof Error ? error.message : "Amp launch failed."); }
      return;
    }
    const connection = await this.connectionForPipe(pipe);
    if (!connection) return this.finishRun(run, "failed", "No exe.dev VM is connected.");
    const workspaceName = String(run.workspace_name || pipe.workspace_name || workspaceNameFor(String(pipe.name)));
    const lease = crypto.randomUUID();
    const worktreePath = `${connection.cwd.replace(/\/$/, "")}/.factorize-runs/${String(run.id)}`;
    this.ctx.storage.sql.exec("UPDATE runs SET herdr_server_namespace='default',worktree_path=?,ownership_lease=?,ownership_generation=ownership_generation+1,agent_session_generation=1,updated_at=? WHERE id=?", worktreePath, lease, now(), run.id);
    if (String(run.provider || "linear") === "linear") await this.safeLinearComment(String(run.issue_id), `Factorize started **${connection.agentKind}** on ${connection.vmName} in Herdr workspace \`${workspaceName}\` for this issue.`);
    const backend = new ExeHerdrBackend(connection, { agentName: String(run.agent_name), workspaceName, runPath: worktreePath, lease });
    const prompt = await decrypt(String(run.prompt), this.env.CREDENTIAL_ENCRYPTION_KEY);
    this.ctx.storage.sql.exec("UPDATE runs SET prompt_delivery_state='submitting',updated_at=? WHERE id=?", now(), run.id);
    const launched = await backend.launch({ runId: String(run.id), prompt });
    const result = launched.command!;
    this.ctx.storage.sql.exec("UPDATE runs SET execution_backend_kind=?,execution_handle=?,execution_capabilities=?,destination_url=?,updated_at=? WHERE id=?", backend.kind, JSON.stringify(launched.handle), JSON.stringify(launched.capabilities), launched.destinationUrl, now(), run.id);
    const execRequest = await encrypt(result.requestBody, this.env.CREDENTIAL_ENCRYPTION_KEY);
    const execResponse = await encrypt(result.body, this.env.CREDENTIAL_ENCRYPTION_KEY);
    this.ctx.storage.sql.exec("UPDATE runs SET exec_request = ?, exec_response = ?, exec_status = ?, exec_exit_code = ?, updated_at = ? WHERE id = ?", execRequest, execResponse, result.status, result.exitCode, now(), run.id);
    this.commandActivity(run.id, "initial agent start", result);
    if (!result.ok || (result.exitCode !== null && result.exitCode !== 0)) return this.finishRun(run, "failed", `Unable to start Herdr agent (exe.dev HTTP ${result.status}, VM exit ${result.exitCode ?? "not reported"}): ${result.body.slice(0, 800)}`);
    const observed = await backend.inspect(launched.handle), verification = observed.command!;
    this.commandActivity(run.id, "initial agent verification", verification);
    if (!verification.ok || (verification.exitCode !== null && verification.exitCode !== 0) || !herdrAgentStatus(verification.body)) {
      return this.beginRecovery(run, pipe, connection, `agent start succeeded but verification was ambiguous (exe.dev HTTP ${verification.status}, VM exit ${verification.exitCode ?? "not reported"})`);
    }
    const identity = parseAgent(verification.body);
    if (!identity) return this.beginRecovery(run, pipe, connection, "agent start succeeded but its structured identity was inconsistent");
    const startupOutput = backend.readOutput ? await backend.readOutput(launched.handle) : null;
    if (startupOutput && agentStartupBlocked(startupOutput)) {
      return this.finishRun(run, "failed", "The agent process started but stopped at an interactive startup permission prompt.");
    }
    this.ctx.storage.sql.exec("UPDATE runs SET prompt_delivery_state='accepted',prompt_delivery_request=?,prompt_delivery_response=?,prompt_delivery_status=?,prompt_delivery_exit_code=?,prompt_accepted=1,updated_at=? WHERE id=?", execRequest, execResponse, result.status, result.exitCode, now(), run.id);
    this.activity(run.id, "prompt_delivered_at_launch", "The initial prompt was passed as a positional harness argument in the successful Herdr launch command.");
    this.persistIdentity(run.id, identity, "running");
  }

  private async pollRun(run: Row): Promise<void> {
    const pipe = this.executionConfig(run.pipe_id);
    if (!pipe) return this.finishRun(run, "failed", "Job configuration is unavailable.");
    if (String(pipe.execution_backend_kind) === "amp") {
      const connection = await this.connection<AmpConnection>(`amp:${String(pipe.execution_connection_id)}`);
      if (!connection) return this.finishRun(run, "failed", "Amp connection is unavailable.");
      const backend = new AmpBackend(connection), observation = await backend.inspect(this.executionHandle(run, backend.kind));
      if (observation.state === "succeeded") return this.finishRun(run, "done", "Completed in Amp. Open the Amp thread for output.");
      if (observation.state === "failed") return this.finishRun(run, "failed", observation.detail ?? "Amp run failed.");
      if (observation.state === "stopped") {
        this.ctx.storage.sql.exec("UPDATE runs SET state='stopped',updated_at=? WHERE id=?", now(), run.id);
        this.ctx.storage.sql.exec("UPDATE job_runs SET state='stopped',updated_at=? WHERE id=?", now(), run.id);
        this.ctx.storage.sql.exec("DELETE FROM active_claims WHERE run_id=?", run.id);
        await this.afterJobTerminal(String(run.pipe_id), String(run.id), "stopped");
        return;
      }
      this.ctx.storage.sql.exec("UPDATE runs SET state=?,updated_at=? WHERE id=?", observation.state, now(), run.id);
      return;
    }
    const connection = await this.connectionForPipe(pipe);
    if (!connection) return this.finishRun(run, "failed", "exe.dev connection is unavailable.");
    if (String(run.state) === "recovering") return this.recoverRun(run, pipe, connection);
    const backend = new ExeHerdrBackend(connection), handle = this.executionHandle(run, backend.kind);
    const observation = await backend.inspect(handle), status = observation.command!;
    if (!status.ok && (status.exitCode === null || status.exitCode === 0)) return; // transient exe.dev/API failure
    if (!status.ok || (status.exitCode !== null && status.exitCode !== 0)) return this.beginRecovery(run, pipe, connection, `expected Herdr agent is no longer resolvable (VM exit ${status.exitCode ?? "unknown"})`);
    const live = parseAgent(status.body);
    if (!live) return this.beginRecovery(run, pipe, connection, "Herdr returned an inconsistent agent identity");
    const terminalOwned = Boolean(run.herdr_terminal_id && ownsPane(this.savedIdentity(run), live, String(run.worktree_path || "")));
    if (terminalOwned) {
      const rotated = String(run.agent_session_value || "") !== live.sessionValue;
      this.persistIdentity(run.id, live, String(run.state), rotated);
      this.ctx.storage.sql.exec("UPDATE runs SET recovery_attempt=0,recovery_started_at=NULL,recovery_next_at=NULL,recovery_reason=NULL WHERE id=?", run.id);
    }
    if (run.herdr_terminal_id && !terminalOwned) return this.beginRecovery(run, pipe, connection, "Herdr alias resolved to a different terminal owner");
    if (!terminalOwned) this.persistIdentity(run.id, live, String(run.state));
    if (observation.state === "blocked") {
      this.ctx.storage.sql.exec("UPDATE runs SET state = 'blocked', updated_at = ? WHERE id = ?", now(), run.id);
      return;
    }
    if (observation.state !== "succeeded") return;
    const output = backend.readOutput ? await backend.readOutput(handle) : null;
    await this.finishRun(run, "done", output ?? "Agent completed; terminal output is not available from this backend.", output !== null);
  }

  private savedIdentity(run: Row): Partial<HerdrIdentity> { return { name: String(run.agent_name || ""), kind: String(run.agent_kind || ""), workspaceId: String(run.herdr_workspace_id || ""), paneId: String(run.herdr_pane_id || ""), terminalId: String(run.herdr_terminal_id || ""), cwd: String(run.herdr_cwd || ""), sessionSource: String(run.agent_session_source || ""), sessionKind: String(run.agent_session_kind || ""), sessionValue: String(run.agent_session_value || "") }; }

  private persistIdentity(runId: unknown, live: HerdrIdentity, state = "running", sessionRotated = false): void {
    this.ctx.storage.sql.exec("UPDATE runs SET state=?,herdr_workspace_id=?,herdr_pane_id=?,herdr_terminal_id=?,agent_session_source=?,agent_session_kind=?,agent_session_value=?,agent_session_generation=agent_session_generation+?,herdr_cwd=?,last_agent_status=?,updated_at=? WHERE id=?", state, live.workspaceId, live.paneId, live.terminalId, live.sessionSource, live.sessionKind, live.sessionValue, sessionRotated ? 1 : 0, live.cwd, live.status, now(), runId);
  }

  private activity(runId: unknown, action: string, detail: string): void {
    this.ctx.storage.sql.exec("INSERT INTO run_activity VALUES (?,?,?,?,?)", id(), runId, action, detail.slice(0, 1000), now());
  }

  private diagnosticExcerpt(body: string): string {
    return body.slice(-700)
      .replace(/("(?:authorization|cookie|token|secret|credential|prompt|body)"\s*:\s*")[^"]*/gi, "$1[redacted]")
      .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [redacted]")
      .replace(/\bexe1[A-Za-z0-9_-]+/g, "[redacted exe.dev token]")
      .replace(/[A-Za-z0-9+/_-]{80,}={0,2}/g, "[redacted long value]")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
      .trim();
  }

  private commandActivity(runId: unknown, command: string, result: { ok: boolean; status: number; exitCode: number | null; body?: string }): void {
    const excerpt = result.body ? this.diagnosticExcerpt(result.body) : "";
    this.activity(runId, "herdr_command", `${command}: HTTP ${result.status}, VM exit ${result.exitCode ?? "not reported"}, ${result.ok ? "request succeeded" : "request failed"}${excerpt ? `; response: ${excerpt}` : "; empty response"}`);
  }

  private async beginRecovery(run: Row, pipe: Row, connection: ExeConnection, reason: string): Promise<void> {
    const started = !run.recovery_started_at;
    this.ctx.storage.sql.exec("UPDATE runs SET state='recovering',recovery_reason=?,recovery_started_at=COALESCE(recovery_started_at,?),recovery_next_at=?,recovery_last_action='inspecting Herdr state',updated_at=? WHERE id=?", reason, now(), Date.now(), now(), run.id);
    this.activity(run.id, "recovery_started", reason);
    const captured = await exec(connection, agentOutputCommand(connection, String(run.agent_name)));
    if (captured.ok && captured.body.trim()) { const encrypted = await encrypt(captured.body, this.env.CREDENTIAL_ENCRYPTION_KEY); this.ctx.storage.sql.exec("UPDATE runs SET result=?,output_captured=1 WHERE id=?", encrypted, run.id); this.activity(run.id, "transcript_captured", "Captured recent output before reconciliation."); }
    if (started && !Number(run.recovery_comment_started) && String(run.provider || "linear") === "linear") {
      await this.safeLinearComment(String(run.issue_id), `Factorize detected a Herdr change and started automatic recovery for run \`${run.id}\`. The concurrency slot remains reserved.`);
      this.ctx.storage.sql.exec("UPDATE runs SET recovery_comment_started=1 WHERE id=?", run.id);
    }
    await this.recoverRun({ ...run, state: "recovering", recovery_reason: reason, recovery_started_at: run.recovery_started_at || now() }, pipe, connection);
  }

  private async recoverRun(run: Row, pipe: Row, connection: ExeConnection): Promise<void> {
    if (Number(run.recovery_next_at || 0) > Date.now()) return;
    const attempt = Number(run.recovery_attempt || 0) + 1;
    const timeoutMs = Math.max(15_000, Number(this.env.RECOVERY_TIMEOUT_MS) || 5 * 60_000), maxAttempts = Math.max(1, Number(this.env.RECOVERY_MAX_ATTEMPTS) || 8);
    if (attempt > maxAttempts || Date.now() - Date.parse(String(run.recovery_started_at)) > timeoutMs) return this.finishRecovery(run, "failed", "Automatic recovery exhausted its bounded retry budget.");
    this.ctx.storage.sql.exec("UPDATE runs SET recovery_attempt=?,recovery_last_action='listing Herdr agents',updated_at=? WHERE id=?", attempt, now(), run.id);
    this.activity(run.id, "recovery_attempt", `Attempt ${attempt}/${maxAttempts}; elapsed ${Math.max(0, Date.now() - Date.parse(String(run.recovery_started_at)))}ms of ${timeoutMs}ms budget.`);
    const listed = await exec(connection, agentListCommand(connection));
    this.commandActivity(run.id, "agent list", listed);
    if (!listed.ok || (listed.exitCode !== null && listed.exitCode !== 0)) { this.scheduleRecovery(run.id, attempt, "transient Herdr agent-list failure"); return; }
    const agents = parseAgentList(listed.body), saved = this.savedIdentity(run);
    const owned = findOwnedAgent(saved, agents, String(run.worktree_path || ""), String(run.agent_name || ""), connection.agentKind, String(run.id));
    if (owned) {
      const rotated = String(run.agent_session_value || "") !== owned.sessionValue;
      this.persistIdentity(run.id, owned, "running", rotated);
      return this.finishRecovery({ ...run, recovery_attempt: attempt }, "running", "Reconciled the owned terminal and worktree; refreshed native session continuity metadata.", owned);
    }
    if (saved.paneId) {
      const pane = await exec(connection, paneGetCommand(connection, saved.paneId));
      this.commandActivity(run.id, "pane get", pane);
      if (pane.ok && (pane.exitCode === null || pane.exitCode === 0)) {
        const lease = await exec(connection, validateWorktreeLeaseCommand(connection, String(run.worktree_path || ""), String(run.ownership_lease || "")));
        this.commandActivity(run.id, "worktree lease validation", lease);
        if (!lease.ok || (lease.exitCode !== null && lease.exitCode !== 0)) { this.scheduleRecovery(run.id, attempt, "owned pane remained but its worktree lease did not validate"); return; }
        const process = await exec(connection, paneProcessInfoCommand(connection, saved.paneId));
        this.commandActivity(run.id, "pane process-info", process);
        const processIdentity = process.ok ? parsePaneProcess(process.body) : null;
        const processCommand = [processIdentity?.executable, ...(processIdentity?.argv ?? [])].join(" ").toLowerCase();
        if (processIdentity && processIdentity.paneId === saved.paneId && processIdentity.cwd === saved.cwd && processCommand.includes(connection.agentKind.toLowerCase())) {
          const adopted = await exec(connection, startAgentInPaneCommand(String(run.agent_name), connection, saved.paneId, String(run.worktree_path)));
          const live = adopted.ok ? parseAgent(adopted.body) : null;
          if (live) return this.finishRecovery(run, "running", "Returned the matching harness in the owned pane to Herdr control.", live);
        }
        if (processIdentity && processIdentity.paneId === saved.paneId && processIdentity.cwd === saved.cwd && /(^|\/)(ba|z|fi)?sh(?:\s|$)/.test(processCommand)) {
          const restarted = await exec(connection, startAgentInPaneCommand(String(run.agent_name), connection, saved.paneId, String(run.worktree_path)));
          const live = restarted.ok ? parseAgent(restarted.body) : null;
          if (live) return this.resumeRecoveredHarness(run, connection, live, "Started a deliberate replacement after the owned pane's agent exited.");
        }
        if (processIdentity && processIdentity.paneId === saved.paneId && processIdentity.cwd === saved.cwd) {
          const replaced = await exec(connection, replaceForegroundCommand(String(run.agent_name), connection, saved.paneId, String(run.worktree_path)));
          const live = replaced.ok ? parseAgent(replaced.body) : null;
          if (live) return this.resumeRecoveredHarness(run, connection, live, "Gracefully stopped the exact validated foreground process and restarted the configured harness.");
          this.scheduleRecovery(run.id, attempt, "foreground process identity changed during validated interruption");
          return;
        }
        const restarted = await exec(connection, startAgentInPaneCommand(String(run.agent_name), connection, saved.paneId, String(run.worktree_path)));
        const live = restarted.ok ? parseAgent(restarted.body) : null;
        if (live) return this.resumeRecoveredHarness(run, connection, live, "Restarted the configured harness in the recovered pane.");
      }
    }
    const prompt = await decrypt(String(run.prompt), this.env.CREDENTIAL_ENCRYPTION_KEY);
    const recoveryPrompt = `${prompt}\n\nRecovery context: inspect the existing repository state and continue completed work rather than repeating it. Last status: ${String(run.last_agent_status || "unknown")}.`;
    const runPath = String(run.worktree_path || ""), lease = String(run.ownership_lease || "");
    if (!runPath || !lease) return this.finishRecovery(run, "failed", "Recovery cannot prove the run directory lease.");
    const replacement = await exec(connection, startAgentCommand(String(run.agent_name), connection, recoveryPrompt, String(run.workspace_name), runPath, lease));
    this.commandActivity(run.id, "replacement agent start", replacement);
    if (replacement.ok && (replacement.exitCode === null || replacement.exitCode === 0)) this.ctx.storage.sql.exec("UPDATE runs SET prompt_accepted=1,prompt_delivery_state='accepted' WHERE id=?", run.id);
    const live = replacement.ok ? parseAgent(replacement.body) : null;
    if (live) return this.finishRecovery(run, "running", "Recreated the deleted pane/workspace and started a replacement harness.", live);
    this.scheduleRecovery(run.id, attempt, "idempotent run-tab reconciliation was not yet verifiable");
  }

  private scheduleRecovery(runId: unknown, attempt: number, action: string): void { const delay = Math.min(60_000, 2_000 * 2 ** Math.min(attempt - 1, 5)); this.ctx.storage.sql.exec("UPDATE runs SET recovery_next_at=?,recovery_last_action=?,updated_at=? WHERE id=?", Date.now() + delay, action, now(), runId); this.activity(runId, "recovery_retry", action); }
  private async resumeRecoveredHarness(run: Row, connection: ExeConnection, live: HerdrIdentity, action: string): Promise<void> { if (Number(run.recovery_prompt_attempted)) return this.finishRecovery(run, "running", `${action} Recovery prompt delivery was previously attempted and was not repeated.`, live); const prompt = await decrypt(String(run.prompt), this.env.CREDENTIAL_ENCRYPTION_KEY); const output = run.result ? await decrypt(String(run.result), this.env.CREDENTIAL_ENCRYPTION_KEY) : ""; const recoveryPrompt = `${prompt}\n\nRecovery context: inspect existing repository state and continue rather than repeating completed work. Last captured output/status:\n${output.slice(-4000)}\n${String(run.last_agent_status || "unknown")}`; this.ctx.storage.sql.exec("UPDATE runs SET recovery_prompt_attempted=1,prompt_delivery_state='submitting' WHERE id=?", run.id); const sent = await exec(connection, `${agentStatusCommand(connection, live.name)} && ${connection.herdrCommand?.trim() || "herdr"} agent prompt '${live.name.replaceAll("'", `'\"'\"'`)}' '${recoveryPrompt.replaceAll("'", `'\"'\"'`)}'`); if (!sent.ok || (sent.exitCode !== null && sent.exitCode !== 0)) { this.ctx.storage.sql.exec("UPDATE runs SET prompt_delivery_state='ambiguous' WHERE id=?", run.id); return this.finishRecovery(run, "running", `${action} Recovery prompt acknowledgement was ambiguous, so it will not be submitted twice.`, live); } this.ctx.storage.sql.exec("UPDATE runs SET recovery_prompt_accepted=1,prompt_delivery_state='accepted' WHERE id=?", run.id); await this.finishRecovery(run, "running", action, live); }
  private async finishRecovery(run: Row, state: "running" | "failed", action: string, live?: HerdrIdentity): Promise<void> { this.activity(run.id, state === "running" ? "recovery_succeeded" : "recovery_failed", action); if (live) this.persistIdentity(run.id, live, state); this.ctx.storage.sql.exec("UPDATE runs SET state=?,recovery_attempt=0,recovery_reason=NULL,recovery_started_at=NULL,recovery_last_action=?,recovery_next_at=NULL,recovery_comment_finished=1,updated_at=? WHERE id=?", state, action, now(), run.id); if (!Number(run.recovery_comment_finished) && String(run.provider || "linear") === "linear") await this.safeLinearComment(String(run.issue_id), `Factorize automatic recovery ${state === "running" ? "succeeded" : "permanently failed"} for run \`${run.id}\`: ${action}`); if (state === "failed") { const encrypted = await encrypt(action, this.env.CREDENTIAL_ENCRYPTION_KEY); this.ctx.storage.sql.exec("UPDATE runs SET result=? WHERE id=?", encrypted, run.id); this.ctx.storage.sql.exec("DELETE FROM active_claims WHERE pipe_id=? AND issue_id=?", run.pipe_id, run.claim_key || run.issue_id); this.ctx.storage.sql.exec("UPDATE runs SET claim_released=1 WHERE id=?", run.id); } }

  private async finishRun(run: Row, state: Extract<RunState, "done" | "failed">, result: string, outputCaptured = false): Promise<void> {
    const transitionedAt = now();
    const encryptedResult = await encrypt(result, this.env.CREDENTIAL_ENCRYPTION_KEY);
    this.ctx.storage.sql.exec("UPDATE runs SET state = ?, result = ?, output_captured=?, updated_at = ? WHERE id = ?", state, encryptedResult, outputCaptured ? 1 : Number(run.output_captured || 0), transitionedAt, run.id);
    this.ctx.storage.sql.exec("UPDATE job_runs SET state=?,updated_at=? WHERE id=?", state === "done" ? "succeeded" : "failed", transitionedAt, run.id);
    this.ctx.storage.sql.exec("DELETE FROM active_claims WHERE pipe_id = ? AND issue_id = ?", run.pipe_id, run.claim_key || run.issue_id);
    this.ctx.storage.sql.exec("UPDATE runs SET claim_released=1 WHERE id=?", run.id);
    await this.afterJobTerminal(String(run.pipe_id), String(run.id), state === "done" ? "succeeded" : "failed", transitionedAt);
    await this.collectRunPane({ ...run, state, output_captured: outputCaptured ? 1 : Number(run.output_captured || 0), claim_released: 1 });
    const heading = state === "done" ? "Factorize completed the agent run." : "Factorize could not complete the agent run.";
    if (String(run.provider || "linear") === "linear") await this.safeLinearComment(String(run.issue_id), `${heading}\n\nRun ID: \`${run.id}\`. Review the Herdr session on the configured VM for details.`);
  }

  private async collectRunPane(run: Row): Promise<void> {
    if (!['done', 'failed', 'cancelled'].includes(String(run.state)) || !Number(run.output_captured) || !Number(run.claim_released) || !run.herdr_pane_id || !run.herdr_terminal_id || !run.worktree_path || !run.ownership_lease) return;
    const pipe = this.executionConfig(run.pipe_id);
    const connection = pipe ? await this.connectionForPipe(pipe) : null;
    const attempt = Number(run.pane_collection_attempt || 0) + 1;
    if (!connection) {
      this.activity(run.id, "pane_collection_retry", `Attempt ${attempt}/8 could not resolve the run's execution connection.`);
      this.schedulePaneCollection(run.id, attempt);
      return;
    }
    let collected;
    try {
      collected = await exec(connection, garbageCollectPaneCommand(connection, String(run.herdr_pane_id), String(run.herdr_terminal_id), String(run.worktree_path), String(run.ownership_lease)));
    } catch (error) {
      this.activity(run.id, "pane_collection_retry", `Attempt ${attempt}/8 could not reach the VM: ${error instanceof Error ? error.message : "unknown error"}`);
      this.schedulePaneCollection(run.id, attempt);
      return;
    }
    this.commandActivity(run.id, "pane garbage collection", collected);
    if (collected.ok && (collected.exitCode === null || collected.exitCode === 0)) {
      this.ctx.storage.sql.exec("UPDATE runs SET pane_collected=1,pane_collection_attempt=?,pane_collection_next_at=NULL,worktree_disposition='retained',updated_at=? WHERE id=?", attempt, now(), run.id);
      return;
    }
    this.schedulePaneCollection(run.id, attempt);
  }

  private schedulePaneCollection(runId: unknown, attempt: number): void {
    const nextAt = attempt < 8 ? Date.now() + Math.min(60_000, 2_000 * 2 ** Math.min(attempt - 1, 5)) : null;
    this.ctx.storage.sql.exec("UPDATE runs SET pane_collection_attempt=?,pane_collection_next_at=?,updated_at=? WHERE id=?", attempt, nextAt, now(), runId);
  }

  private async safeLinearComment(issueId: string, body: string): Promise<void> { try { await this.postLinearComment(issueId, body); } catch (error) { console.warn(JSON.stringify({ event: "linear_notification_failed", issueId, message: error instanceof Error ? error.message : "unknown" })); } }

  private async postLinearComment(issueId: string, body: string): Promise<void> {
    const linear = await this.connection<{ accessToken: string }>("linear");
    if (!linear) return;
    await this.linear(linear.accessToken, "mutation($issueId:String!,$body:String!){ commentCreate(input:{issueId:$issueId,body:$body}){ success } }", { issueId, body });
  }

  private async linear(token: string, query: string, variables: Record<string, unknown>): Promise<any> {
    const request = async (accessToken: string) => {
      const response = await fetch("https://api.linear.app/graphql", { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });
      const payload = await response.json() as any;
      return { response, payload };
    };
    let result = await request(token);
    if (isLinearAuthenticationError(result.response.status, result.payload.errors)) {
      const refreshed = await this.refreshLinearAccessToken(token);
      result = await request(refreshed);
    }
    if (!result.response.ok || result.payload.errors?.length) throw new Error(result.payload.errors?.[0]?.message ?? `Linear request failed (${result.response.status})`);
    return result.payload.data;
  }

  private async refreshLinearAccessToken(staleToken: string): Promise<string> {
    if (this.linearRefresh) return this.linearRefresh;
    this.linearRefresh = (async () => {
      const linear = await this.connection<{ accessToken: string; refreshToken: string; organizationId: string; organizationName?: string }>("linear");
      if (!linear?.refreshToken) throw new Error("Reconnect Linear to continue.");
      // Another request may have refreshed the rotating token while this one was in flight.
      if (linear.accessToken !== staleToken) return linear.accessToken;
      const tokens = await refreshLinearToken(linear.refreshToken, this.env.LINEAR_CLIENT_ID, this.env.LINEAR_CLIENT_SECRET);
      await this.putConnection("linear", {
        ...linear,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? linear.refreshToken,
      });
      return tokens.access_token;
    })();
    try {
      return await this.linearRefresh;
    } finally {
      this.linearRefresh = undefined;
    }
  }

  private async putConnection(kind: string, value: unknown): Promise<void> {
    const encrypted = await encrypt(JSON.stringify(value), this.env.CREDENTIAL_ENCRYPTION_KEY);
    this.ctx.storage.sql.exec("INSERT INTO connections (kind,value,updated_at) VALUES (?,?,?) ON CONFLICT(kind) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at", kind, encrypted, now());
  }

  private async connection<T>(kind: string): Promise<T | null> {
    const row = this.one("SELECT value FROM connections WHERE kind = ?", kind) as Row | undefined;
    return row ? JSON.parse(await decrypt(String(row.value), this.env.CREDENTIAL_ENCRYPTION_KEY)) as T : null;
  }

  private async exeConnection(connectionId?: string): Promise<ExeConnection | null> {
    if (connectionId && connectionId !== "default") {
      const saved = await this.connection<ExeConnection>(`exe:${connectionId}`);
      if (saved) return saved;
    }
    return this.connection<ExeConnection>("exe");
  }

  private async exeConnections(): Promise<Array<ExeConnection & { connectionId: string }>> {
    const rows = this.rows("SELECT kind, value FROM connections WHERE kind LIKE 'exe:%' ORDER BY updated_at DESC");
    const connections = await Promise.all(rows.map(async (row) => ({
      ...(JSON.parse(await decrypt(String(row.value), this.env.CREDENTIAL_ENCRYPTION_KEY)) as ExeConnection),
      connectionId: String(row.kind).slice(4),
    })));
    if (connections.length) return connections;
    const legacy = await this.connection<ExeConnection>("exe");
    return legacy ? [{ ...legacy, connectionId: "default" }] : [];
  }

  private async ampConnections(): Promise<Array<AmpConnection & { connectionId: string }>> {
    const rows = this.rows("SELECT kind, value FROM connections WHERE kind LIKE 'amp:%' ORDER BY updated_at DESC");
    return Promise.all(rows.map(async row => ({ ...(JSON.parse(await decrypt(String(row.value), this.env.CREDENTIAL_ENCRYPTION_KEY)) as AmpConnection), connectionId: String(row.kind).slice(4) })));
  }

  private async connectionForPipe(pipe: Row): Promise<ExeConnection | null> {
    const connection = await this.exeConnection(String(pipe.exe_connection_id || "default"));
    return connection && pipe.cwd ? { ...connection, cwd: workingDirectoryFor(String(pipe.cwd), String(pipe.workspace_name)) } : connection;
  }

  private async upsertMember(input: unknown): Promise<Response> {
    const member = input as { userId?: string; email?: string };
    if (!member.userId || !member.email) throw new Error("Member identity is required");
    const existing = this.one("SELECT user_id,email,role,session_version FROM members WHERE user_id = ?", member.userId) as Row | undefined;
    if (existing) return json(existing);
    const count = this.one("SELECT count(*) AS count FROM members") as Row;
    // Only the initial connector receives owner authority. Other workspace users are pending until invited.
    const role = Number(count.count) === 0 ? "owner" : "pending";
    this.ctx.storage.sql.exec("INSERT INTO members (user_id,email,role,session_version,created_at) VALUES (?,?,?,?,?)", member.userId, member.email, role, 1, now());
    return json({ user_id: member.userId, email: member.email, role, session_version: 1 });
  }

  private githubInstallations(): Response { return json(this.rows("SELECT installation_id AS installationId,account_login AS accountLogin,account_type AS accountType,state,updated_at AS updatedAt FROM github_installations ORDER BY account_login")); }

  private saveGitHubInstallation(input: any): Response {
    if (!Number.isSafeInteger(input.installationId)) throw new Error("Invalid installation");
    this.ctx.storage.sql.exec("INSERT INTO github_installations VALUES (?,?,?,?,?) ON CONFLICT(installation_id) DO UPDATE SET account_login=excluded.account_login,account_type=excluded.account_type,state=excluded.state,updated_at=excluded.updated_at", input.installationId, String(input.accountLogin ?? ""), String(input.accountType ?? ""), String(input.state ?? "active"), now());
    return json({ ok: true });
  }

  private updateGitHubInstallation(installationId: number, input: any): Response {
    const existing = this.one("SELECT installation_id FROM github_installations WHERE installation_id=?", installationId);
    if (!existing) return new Response("Not found", { status: 404 });
    const state = ["active", "suspended", "removed"].includes(input.state) ? input.state : "removed";
    this.ctx.storage.sql.exec("UPDATE github_installations SET state=?,updated_at=? WHERE installation_id=?", state, now(), installationId);
    return json({ ok: true });
  }

  private saveSetupState(input: any): Response {
    if (!input.nonce || !Number.isFinite(input.exp)) throw new Error("Invalid setup state");
    this.ctx.storage.sql.exec("INSERT INTO github_setup_states (nonce,expires_at) VALUES (?,?)", input.nonce, input.exp);
    return json({ ok: true });
  }

  private consumeSetupState(input: any): Response {
    const state = this.one("SELECT * FROM github_setup_states WHERE nonce=?", input.nonce) as Row | undefined;
    if (!state || state.used_at || Number(state.expires_at) <= Math.floor(Date.now() / 1000)) return new Response("Invalid setup state", { status: 409 });
    this.ctx.storage.sql.exec("UPDATE github_setup_states SET used_at=? WHERE nonce=? AND used_at IS NULL", now(), input.nonce);
    return json({ ok: true });
  }

  private async githubRepositories(installationId: number): Promise<Response> {
    const installation = this.one("SELECT state FROM github_installations WHERE installation_id=?", installationId) as Row | undefined;
    if (!installation || installation.state !== "active") return new Response("Installation is disconnected", { status: 409 });
    const token = await installationToken(this.env, installationId);
    const repositories: any[] = []; let page = 1;
    while (page <= 10) {
      const response = await fetch(`https://api.github.com/installation/repositories?per_page=100&page=${page}`, { headers: githubHeaders(token) });
      const body = await response.json() as any;
      if (!response.ok) throw new Error(body.message ?? `GitHub repository request failed (${response.status})`);
      repositories.push(...(body.repositories ?? []));
      if ((body.repositories ?? []).length < 100) break;
      page += 1;
    }
    return json(repositories.map(normalizeRepository));
  }

  private async validateSource(input: PipeInput): Promise<FlowSource> {
    if (!input.source || input.source.kind === "linear") {
      const projectId = input.source?.kind === "linear" ? input.source.projectId : input.projectId;
      const rules = this.matchRules(input.source?.kind === "linear" ? { ...input, matchRules: input.source.matchRules } : input);
      if (!projectId) throw new Error("Pipe name and project are required");
      return { kind: "linear", projectId, matchRules: rules };
    }
    const source = input.source;
    if (source.kind === "custom") {
      throw new Error("Custom Flow sources are no longer supported.");
    }
    if (source.baseRef !== "main" || source.trigger !== "merge_queue_conflict" || !Number.isSafeInteger(source.installationId) || !Number.isSafeInteger(source.repositoryId)) throw new Error("Invalid GitHub source");
    const installation = this.one("SELECT state FROM github_installations WHERE installation_id=?", source.installationId) as Row | undefined;
    if (!installation || installation.state !== "active") throw new Error("GitHub installation is disconnected");
    const token = await installationToken(this.env, source.installationId);
    const response = await fetch(`https://api.github.com/repositories/${source.repositoryId}`, { headers: githubHeaders(token) });
    const body = await response.json() as any;
    if (!response.ok) throw new Error("The installation cannot access this repository");
    const repository = normalizeRepository(body);
    if (repository.defaultBranch !== "main") throw new Error("GitHub flows require a repository whose default branch is main");
    return { kind: "github", installationId: source.installationId, repositoryId: repository.id, repositoryOwner: repository.owner, repositoryName: repository.name, repositoryFullName: repository.fullName, baseRef: "main", trigger: "merge_queue_conflict" };
  }

  private sourceFor(pipe: Row): FlowSource {
    if (pipe.source_kind === "github" || pipe.source_kind === "custom") { try { return JSON.parse(String(pipe.source_config)) as FlowSource; } catch { /* invalid config cannot trigger */ } }
    return { kind: "linear", projectId: String(pipe.project_id), matchRules: this.savedMatchRules(pipe) };
  }

  private getMember(userId: string): Response {
    const member = this.one("SELECT user_id,email,role,session_version FROM members WHERE user_id = ?", userId);
    return member ? json(member) : new Response("Not found", { status: 404 });
  }

  private revokeMember(userId: string): Response {
    this.ctx.storage.sql.exec("UPDATE members SET session_version = session_version + 1 WHERE user_id = ?", userId);
    return json({ ok: true });
  }

  private createAccessToken(input: unknown): Response {
    const value = object(input), name = text(value.name).trim(), digest = text(value.digest), userId = text(value.userId);
    const scopes = Array.isArray(value.scopes) ? [...new Set(value.scopes.filter((scope: unknown) => typeof scope === "string"))] : [];
    const expiresAt = text(value.expiresAt), sessionVersion = Number(value.sessionVersion);
    const supported = new Set(["flows:read", "flows:write", "runs:read", "runs:write"]);
    if (!name || name.length > 100 || !digest || !userId || !scopes.length || scopes.some(scope => !supported.has(scope)) || !Number.isInteger(sessionVersion) || !Number.isFinite(Date.parse(expiresAt))) return Response.json({ error: "Invalid access token metadata" }, { status: 400 });
    const tokenId = id(), createdAt = now();
    this.ctx.storage.sql.exec("INSERT INTO access_tokens(id,name,digest,user_id,session_version,scopes,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)", tokenId, name, digest, userId, sessionVersion, JSON.stringify(scopes), createdAt, expiresAt);
    return Response.json({ id: tokenId, name, scopes, created_at: createdAt, expires_at: expiresAt }, { status: 201 });
  }

  private authenticateAccessToken(input: unknown): Response {
    const digest = text(object(input).digest), usedAt = now();
    const token = this.one("SELECT id,user_id,session_version,scopes FROM access_tokens WHERE digest=? AND revoked_at IS NULL AND expires_at>?", digest, usedAt);
    if (!token) return Response.json({ error: "Invalid token" }, { status: 401 });
    this.ctx.storage.sql.exec("UPDATE access_tokens SET last_used_at=? WHERE id=?", usedAt, token.id);
    return json({ tenantId: text(object(input).tenantId), userId: token.user_id, sessionVersion: token.session_version, scopes: JSON.parse(String(token.scopes)), accessTokenId: token.id });
  }

  private activeAccessToken(tokenId: string): Response {
    return this.one("SELECT id FROM access_tokens WHERE id=? AND revoked_at IS NULL AND expires_at>?", tokenId, now()) ? json({ active: true }) : Response.json({ error: "Invalid token" }, { status: 401 });
  }

  private revokeAccessToken(tokenId: string): Response {
    const result = this.ctx.storage.sql.exec("UPDATE access_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE id=?", now(), tokenId);
    return result.rowsWritten ? json({ revoked: true }) : Response.json({ error: "Access token not found" }, { status: 404 });
  }

  private availableWorkspaceName(value: string): string {
    const base = workspaceNameFor(value);
    let candidate = base;
    let suffix = 2;
    while (this.one("SELECT id FROM pipes WHERE workspace_name = ?", candidate)) {
      candidate = `${base.slice(0, Math.max(1, 48 - String(suffix).length - 1))}-${suffix++}`;
    }
    return candidate;
  }

  private flowId(provided: unknown, name: string): string {
    const value = typeof provided === "string" && provided.trim() ? provided.trim() : workspaceNameFor(name).slice(0, 30);
    if (!HERDR_FLOW_NAME.test(value)) throw new Error("Flow ID must start with a lowercase letter and contain only lowercase letters, digits, hyphens, or underscores (30 characters maximum).");
    return value;
  }

  private contextTemplate(value: unknown): string {
    if (value === undefined || value === null || value === "") return DEFAULT_CONTEXT_TEMPLATE;
    if (typeof value !== "string" || !value.trim()) throw new Error("Context template is required.");
    if (value.length > 50_000) throw new Error("Context template must be 50,000 characters or fewer.");
    try {
      Mustache.parse(value);
    } catch {
      throw new Error("Context template contains invalid Mustache syntax.");
    }
    return value;
  }

  private cwdTemplate(value: unknown, flowId: string): string {
    if (typeof value !== "string" || !value.trim()) throw new Error("Choose a working directory.");
    try {
      Mustache.parse(value);
      if (!workingDirectoryFor(value, flowId).trim()) throw new Error();
    } catch {
      throw new Error("Working directory must be a valid Mustache template that renders to a path.");
    }
    return value;
  }

  private matchRules(input: PipeInput): MatchRule[] {
    const rules = input.matchRules;
    const validTypes: FilterType[] = ["owner", "creator", "status", "label", "assignee"];
    if (!rules.length) throw new Error("Configure at least one issue matching rule.");
    if (!rules.every((rule) => rule && validTypes.includes(rule.type) && typeof rule.targetId === "string" && rule.targetId.trim())) throw new Error("Each matching rule needs a supported type and target.");
    return rules.map((rule) => ({ type: rule.type, targetId: rule.targetId.trim() }));
  }

  private savedMatchRules(pipe: Row): MatchRule[] {
    return this.matchRules({ name: "", projectId: "", matchRules: JSON.parse(String(pipe.match_rules)), maxConcurrency: 1 });
  }

  private nextRunSlot(pipe: Row, runId: string): number {
    const base = String(pipe.workspace_name);
    const active = this.rows("SELECT workspace_name FROM runs WHERE pipe_id = ? AND id != ? AND state IN ('starting','running','blocked','recovering')", pipe.id, runId);
    const occupied = new Set(active.map((run) => {
      const match = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`).exec(String(run.workspace_name));
      return match ? Number(match[1]) : 0;
    }));
    for (let slot = 1; slot <= Number(pipe.max_concurrency); slot++) if (!occupied.has(slot)) return slot;
    return Number(pipe.max_concurrency);
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    if (!this.rows(`PRAGMA table_info(${table})`).some((row) => row.name === column)) this.ctx.storage.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  private rows(query: string, ...params: unknown[]): Row[] { return [...this.ctx.storage.sql.exec(query, ...params)] as Row[]; }
  private one(query: string, ...params: unknown[]): Row | undefined { return this.rows(query, ...params)[0]; }
}

/** @deprecated Retained only until the Phase 2 namespace-retirement deployment. */
export class Tenant extends DurableObject<Env> {}
