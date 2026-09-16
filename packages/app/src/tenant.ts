import { DurableObject } from "cloudflare:workers";
import Mustache from "mustache";
import { decrypt, encrypt } from "./crypto";
import { agentListCommand, agentOutputCommand, agentStartupBlocked, agentStatusCommand, connectionCheckCommand, defaultAgentCommand, exec, garbageCollectPaneCommand, herdrAgentStatus, herdrCheckCommand, paneGetCommand, paneProcessInfoCommand, replaceForegroundCommand, startAgentCommand, startAgentInPaneCommand, stopAgentCommand, validateWorktreeLeaseCommand, type ExeConnection } from "./exe";
import { findOwnedAgent, ownsPane, parseAgent, parseAgentList, parsePaneProcess, type HerdrIdentity } from "./recovery";
import { LINEAR_ISSUE_PROJECT_QUERY, LINEAR_OPTION_QUERIES, LINEAR_PROJECTS_QUERY, isLinearAuthenticationError, refreshLinearToken } from "./linear";
import { matchingIssue } from "./matcher";
import type { Env, ExeConnectionInput, FilterType, MatchRule, PipeInput, RunState } from "./types";
import { workingDirectoryFor, workspaceNameFor } from "./workspace";
import { githubClaimKey, githubHeaders, installationToken, normalizeRepository, renderGitHubPrompt } from "./github";
import type { FlowSource, WorkItem } from "./types";
import { invokeCustomHandler, validateCustomHandler } from "./custom-handler";
import { sanitizeTailEvent, suppressTailEvent, tailFingerprint, verifyTailDelivery } from "./cloudflare-tail";
import { ExeHerdrBackend } from "./exe-herdr-backend";
import { DEFAULT_CONTEXT_TEMPLATE, LinearSourceAdapter, linearTicketPrompt, renderContextTemplate } from "./linear-source";
import { renderSourcePrompt } from "./source-lifecycle";
import { JOB_SCHEMA } from "./job-domain";
import { normalizeExecutionState, type RunHandle } from "./execution";

export { DEFAULT_CONTEXT_TEMPLATE, linearTicketPrompt, renderContextTemplate } from "./linear-source";

type Row = Record<string, unknown>;
const json = (value: unknown) => Response.json(value);
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const HERDR_FLOW_NAME = /^[a-z][a-z0-9_-]{0,29}$/;

const object = (value: unknown): Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const text = (value: unknown): string => typeof value === "string" ? value : "";
const linearSource = new LinearSourceAdapter();

export class Tenant extends DurableObject<Env> {
  private linearRefresh?: Promise<string>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      ${JOB_SCHEMA}
      CREATE TABLE IF NOT EXISTS connections (kind TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS members (user_id TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL, session_version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
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
    for (const [column, definition] of Object.entries({ herdr_server_namespace: "TEXT NOT NULL DEFAULT 'default'", worktree_path: "TEXT", ownership_lease: "TEXT", ownership_generation: "INTEGER NOT NULL DEFAULT 0", agent_session_generation: "INTEGER NOT NULL DEFAULT 0", output_captured: "INTEGER NOT NULL DEFAULT 0", claim_released: "INTEGER NOT NULL DEFAULT 0", pane_collected: "INTEGER NOT NULL DEFAULT 0", worktree_disposition: "TEXT" })) this.ensureColumn("runs", column, definition);
    for (const [column, definition] of Object.entries({ herdr_workspace_id: "TEXT", herdr_pane_id: "TEXT", herdr_terminal_id: "TEXT", agent_session_source: "TEXT", agent_session_kind: "TEXT", agent_session_value: "TEXT", herdr_cwd: "TEXT", last_agent_status: "TEXT", recovery_attempt: "INTEGER NOT NULL DEFAULT 0", recovery_reason: "TEXT", recovery_started_at: "TEXT", recovery_last_action: "TEXT", recovery_next_at: "INTEGER", recovery_comment_started: "INTEGER NOT NULL DEFAULT 0", recovery_comment_finished: "INTEGER NOT NULL DEFAULT 0", prompt_accepted: "INTEGER NOT NULL DEFAULT 0", recovery_prompt_attempted: "INTEGER NOT NULL DEFAULT 0", recovery_prompt_accepted: "INTEGER NOT NULL DEFAULT 0" })) this.ensureColumn("runs", column, definition);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/pipes") return json(this.rows(`SELECT id, name, project_id, team_id, filter_type, filter_target_id, source_kind, source_config, trigger_kind, trigger_config, max_concurrency, workspace_name, agent_kind, enabled, created_at,
        (SELECT count(*) FROM runs WHERE runs.pipe_id = pipes.id AND runs.state IN ('starting','running','blocked','recovering')) AS active_agents,
        (SELECT state FROM runs WHERE runs.pipe_id = pipes.id ORDER BY updated_at DESC, id DESC LIMIT 1) AS latest_run_state
        FROM pipes ORDER BY created_at DESC`));
      if (request.method === "GET" && url.pathname.startsWith("/pipes/")) return await this.flowDetail(url.pathname.split("/")[2] ?? "", url);
      if (request.method === "GET" && url.pathname === "/runs") return json(this.rows("SELECT id, pipe_id, issue_id, agent_name, state, created_at, updated_at FROM runs ORDER BY created_at DESC LIMIT 100"));
      if (request.method === "GET" && /^\/runs\/[^/]+$/.test(url.pathname)) return await this.runDetail(decodeURIComponent(url.pathname.split("/")[2] ?? ""));
      if (request.method === "GET" && url.pathname === "/v1/runs") return this.listRuns(url);
      if (request.method === "GET" && /^\/v1\/runs\/[^/]+$/.test(url.pathname)) return await this.getRun(decodeURIComponent(url.pathname.split("/")[3] ?? ""));
      if (request.method === "POST" && /^\/v1\/runs\/[^/]+\/stop$/.test(url.pathname)) return await this.stopRun(decodeURIComponent(url.pathname.split("/")[3] ?? ""));
      if (request.method === "GET" && url.pathname === "/v1/events") return this.listEvents(url);
      if (request.method === "GET" && /^\/v1\/flows\/[^/]+$/.test(url.pathname)) return this.getFlow(decodeURIComponent(url.pathname.split("/")[3] ?? ""));
      if (request.method === "GET" && url.pathname === "/connections/status") return await this.connectionStatus();
      if (request.method === "POST" && url.pathname === "/members") return await this.upsertMember(await request.json());
      if (request.method === "GET" && url.pathname.startsWith("/members/")) return this.getMember(url.pathname.split("/")[2] ?? "");
      if (request.method === "POST" && url.pathname.startsWith("/members/") && url.pathname.endsWith("/revoke")) return this.revokeMember(url.pathname.split("/")[2] ?? "");
      if (request.method === "GET" && url.pathname === "/linear/projects") return await this.linearProjects();
      if (request.method === "GET" && url.pathname === "/linear/options") return await this.linearOptions();
      if (request.method === "PUT" && url.pathname === "/connections/linear") return await this.saveLinear(await request.json());
      if (request.method === "PUT" && url.pathname === "/connections/exe") return await this.saveExe(await request.json());
      if (request.method === "POST" && url.pathname === "/connections/exe/test") return await this.testExe(await request.json());
      if (request.method === "POST" && url.pathname === "/pipes") return await this.createPipe(await request.json() as PipeInput);
      if (request.method === "PUT" && url.pathname.startsWith("/pipes/")) return await this.updatePipe(url.pathname.split("/")[2] ?? "", await request.json() as PipeInput);
      if (request.method === "DELETE" && url.pathname.startsWith("/pipes/")) return this.deletePipe(url.pathname.split("/")[2] ?? "");
      if (request.method === "POST" && url.pathname === "/webhook/linear") return await this.acceptLinearWebhook(await request.json() as Record<string, any>, request.headers.get("linear-delivery"));
      if (request.method === "POST" && url.pathname === "/webhook/github") return await this.acceptGitHubWebhook(await request.json() as Record<string, any>, request.headers.get("github-delivery"), request.headers.get("github-event"));
      const tailMatch = url.pathname.match(/^\/webhook\/cloudflare\/([^/]+)$/);
      if (request.method === "POST" && tailMatch) return await this.acceptCloudflareTail(decodeURIComponent(tailMatch[1]), await request.text(), request.headers);
      const tailTestMatch = url.pathname.match(/^\/cloudflare-tail\/([^/]+)\/test$/);
      if (request.method === "POST" && tailTestMatch) return await this.testCloudflareTail(decodeURIComponent(tailTestMatch[1]));
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
    // Release completed slots before looking at the queue, so capacity is used
    // immediately rather than waiting for the next polling alarm.
    const running = this.rows("SELECT * FROM runs WHERE state IN ('running','blocked','recovering') ORDER BY updated_at LIMIT 40");
    for (const run of running) await this.pollRun(run);
    const queued = this.rows("SELECT * FROM runs WHERE state = 'queued' ORDER BY created_at LIMIT 20");
    for (const run of queued) {
      const pipe = this.one("SELECT * FROM pipes WHERE id = ?", run.pipe_id) as Row | undefined;
      if (!pipe) continue;
      const active = this.one("SELECT count(*) AS count FROM runs WHERE pipe_id = ? AND state IN ('starting','running','blocked','recovering')", pipe.id) as Row;
      if (Number(active.count) >= Number(pipe.max_concurrency)) continue;
      const name = `${String(pipe.workspace_name).slice(0, 20)}-${String(run.id).replaceAll("-", "").slice(0, 8)}`;
      this.ctx.storage.sql.exec("UPDATE runs SET state = 'starting', agent_name = ?, workspace_name = ?, updated_at = ? WHERE id = ? AND state = 'queued'", name, pipe.workspace_name, now(), run.id);
      await this.startRun({ ...run, agent_name: name, workspace_name: pipe.workspace_name }, pipe);
    }

    const pending = this.one("SELECT count(*) AS count FROM runs WHERE state IN ('queued','starting','running','blocked','recovering')") as Row;
    const verification = this.one("SELECT min(next_attempt_at) AS next_attempt_at FROM pending_verifications") as Row;
    const nextVerification = Number(verification?.next_attempt_at || 0);
    if (Number(pending.count) > 0 || nextVerification) await this.ctx.storage.setAlarm(nextVerification ? Math.min(Date.now() + 15_000, nextVerification) : Date.now() + 15_000);
  }

  private async saveLinear(input: unknown): Promise<Response> {
    const value = input as { accessToken?: string; refreshToken?: string; organizationId?: string; organizationName?: string };
    if (!value.accessToken || !value.refreshToken || !value.organizationId) throw new Error("Linear tokens and organization are required");
    await this.putConnection("linear", value);
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
    const linear = await this.connection<{ organizationName?: string }>("linear");
    const connections = await this.exeConnections();
    const exe = await this.connection<ExeConnectionInput>("exe");
    return json({
      linear: linear ? { organizationName: linear.organizationName ?? null } : null,
      exe: exe ? { vmName: exe.vmName, agentKind: exe.agentKind, cwd: exe.cwd, herdrCommand: exe.herdrCommand ?? "herdr", agentCommand: exe.agentCommand ?? defaultAgentCommand(exe.agentKind) } : null,
      exeConnections: connections.map(({ apiToken, ...connection }) => connection),
    });
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
    const limit = this.pageSize(url), cursor = this.cursor(url), flowId = url.searchParams.get("flowId"), state = url.searchParams.get("state");
    const clauses: string[] = [], args: unknown[] = [];
    if (flowId) { clauses.push("pipe_id = ?"); args.push(flowId); }
    if (state === "succeeded") { clauses.push("state IN ('succeeded','done')"); }
    else if (state === "stopped") { clauses.push("state IN ('stopped','cancelled')"); }
    else if (state === "starting") { clauses.push("state IN ('starting','recovering')"); }
    else if (state) { clauses.push("state = ?"); args.push(state); }
    if (cursor) { clauses.push("(created_at < ? OR (created_at = ? AND id < ?))"); args.push(cursor.at, cursor.at, cursor.id); }
    const rows = this.rows(`SELECT id, pipe_id AS flow_id, issue_id, issue_url, agent_name, workspace_name, agent_kind, state, provider, execution_backend_kind AS backend_kind, execution_capabilities AS capabilities, destination_url, created_at, updated_at FROM runs ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY created_at DESC, id DESC LIMIT ?`, ...args, limit + 1);
    const hasMore = rows.length > limit, items = rows.slice(0, limit);
    for (const item of items) this.presentExecution(item);
    return json({ items, nextCursor: hasMore ? this.nextCursor(items.at(-1), "created_at") : null });
  }

  private async getRun(runId: string): Promise<Response> {
    const run = this.one("SELECT id, pipe_id AS flow_id, issue_id, issue_url, agent_name, workspace_name, agent_kind, state, provider, execution_backend_kind AS backend_kind, execution_capabilities AS capabilities, destination_url, result, exec_status, exec_exit_code, recovery_last_action, created_at, updated_at FROM runs WHERE id = ?", runId);
    if (!run) return new Response("Not found", { status: 404 });
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
      const pipe = this.one("SELECT * FROM pipes WHERE id = ?", run.pipe_id) as Row | undefined;
      if (pipe) {
        const connection = await this.exeConnection(String(pipe.exe_connection_id || "default"));
        if (connection && run.agent_name) {
          const backend = new ExeHerdrBackend(connection);
          this.ctx.storage.sql.exec("UPDATE runs SET state='stopping',updated_at=? WHERE id=?", now(), runId);
          const stopped = await backend.stop(this.executionHandle(run, backend.kind));
          if (stopped.state !== "stopped") return Response.json({ error: "Could not stop the active agent" }, { status: 502 });
        }
      }
    }
    this.ctx.storage.sql.exec("UPDATE runs SET state = 'stopped', result = ?, updated_at = ? WHERE id = ?", await encrypt("Stopped by user", this.env.CREDENTIAL_ENCRYPTION_KEY), now(), runId);
    this.ctx.storage.sql.exec("DELETE FROM active_claims WHERE run_id = ?", runId);
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

  private async acceptLinearWebhook(event: Record<string, any>, deliveryId: string | null): Promise<Response> {
    if (!deliveryId) return new Response("Missing delivery ID", { status: 400 });
    if (this.one("SELECT id FROM deliveries WHERE id = ?", deliveryId)) return new Response(null, { status: 200 });
    this.ctx.storage.sql.exec("INSERT INTO deliveries (id,pipe_id,received_at) VALUES (?,?,?)", deliveryId, "app-webhook", now());
    let matchingEvent = event;
    let data = matchingEvent.data ?? {};
    let projectId = data.project?.id ?? data.issue?.project?.id;
    const issueId = data.issueId ?? data.issue?.id ?? (matchingEvent.type === "Issue" ? data.id : undefined);
    const pipes = this.rows("SELECT * FROM pipes WHERE enabled = 1 AND source_kind = 'linear'");
    const custom = this.rows("SELECT * FROM pipes WHERE enabled = 1 AND source_kind = 'custom'");

    // IssueLabel is a join entity. Linear serializes it with issueId and labelId,
    // and does not consistently expand the linked issue or its project. Resolve it
    // once so label flows can still be scoped to their selected project.
    if (!projectId && matchingEvent.type === "IssueLabel" && typeof issueId === "string") {
      const linear = await this.connection<{ accessToken: string }>("linear");
      const issue = linear ? await this.linear(linear.accessToken, LINEAR_ISSUE_PROJECT_QUERY, { id: issueId }) : null;
      projectId = issue?.issue?.project?.id;
      if (projectId) {
        data = { ...data, ...issue.issue, issue: { ...data.issue, ...issue.issue, id: issueId, project: { id: projectId } } };
        matchingEvent = { ...matchingEvent, data };
      }
    }

    for (const pipe of pipes) {
      if (projectId !== pipe.project_id) continue;
      const matchingIssueId = matchingIssue(matchingEvent, { projectId: String(pipe.project_id), matchRules: this.savedMatchRules(pipe) });
      if (!matchingIssueId) {
        this.recordFlowEvent(pipe, deliveryId, null, null, matchingEvent, "ignored", "Webhook did not match this flow's trigger.");
        continue;
      }
      const workItem = linearSource.toWorkItem(data, matchingIssueId, matchingEvent);
      await this.queueWorkItem(pipe, deliveryId, workItem, linearSource.renderPrompt(String(pipe.context_template || DEFAULT_CONTEXT_TEMPLATE), data, String(pipe.name)));
    }
    await Promise.all(custom.map((pipe) => this.evaluateCustom(pipe, "linear", deliveryId, event)));
    await this.ctx.storage.setAlarm(Date.now());
    return new Response(null, { status: 200 });
  }

  private async acceptGitHubWebhook(event: Record<string, any>, deliveryId: string | null, eventName: string | null): Promise<Response> {
    if (!deliveryId || !eventName) return new Response("Missing delivery metadata", { status: 400 });
    if (this.one("SELECT id FROM deliveries WHERE id = ?", deliveryId)) return new Response(null, { status: 200 });
    this.ctx.storage.sql.exec("INSERT INTO deliveries (id,pipe_id,received_at) VALUES (?,?,?)", deliveryId, "github-app", now());
    const custom = this.rows("SELECT * FROM pipes WHERE enabled=1 AND source_kind='custom'");
    await Promise.all(custom.map((pipe) => this.evaluateCustom(pipe, "github", deliveryId, event)));
    if (eventName !== "pull_request" || event.action !== "dequeued") { await this.ctx.storage.setAlarm(Date.now()); return new Response(null, { status: 202 }); }
    const installationId = event.installation?.id, repositoryId = event.repository?.id, pull = event.pull_request;
    if (!Number.isSafeInteger(installationId) || !Number.isSafeInteger(repositoryId) || !Number.isSafeInteger(pull?.number)) return new Response(null, { status: 202 });
    const pipes = this.rows("SELECT * FROM pipes WHERE enabled=1 AND source_kind='github'");
    for (const pipe of pipes) {
      const source = this.sourceFor(pipe);
      if (source.kind !== "github" || source.installationId !== installationId || source.repositoryId !== repositoryId || pull.state !== "open" || pull.base?.ref !== "main") continue;
      const minimal = { number: pull.number, url: pull.html_url, title: pull.title ?? "", body: pull.body ?? "", author: pull.user?.login ?? "", base: { ref: pull.base.ref, sha: pull.base.sha }, head: { ref: pull.head?.ref ?? "", sha: pull.head?.sha ?? "", repository: pull.head?.repo?.full_name ?? "" } };
      this.ctx.storage.sql.exec("INSERT INTO pending_verifications VALUES (?,?,?,?,?,?,?,?,?,?,?)", id(), pipe.id, deliveryId, installationId, repositoryId, source.repositoryOwner ?? event.repository.owner?.login ?? "", source.repositoryName ?? event.repository.name ?? "", pull.number, 0, Date.now(), JSON.stringify(minimal));
      this.recordFlowEvent(pipe, deliveryId, githubClaimKey(repositoryId, pull.number), pull.html_url ?? null, { type: "pull_request", action: "dequeued" }, "candidate", "Candidate received; waiting for GitHub mergeability verification.", "github");
    }
    await this.ctx.storage.setAlarm(Date.now());
    return new Response(null, { status: 202 });
  }

  private async acceptCloudflareTail(flowId: string, raw: string, headers: Headers): Promise<Response> {
    const pipe = this.one("SELECT * FROM pipes WHERE id=? AND enabled=1", flowId) as Row | undefined;
    if (!pipe) return new Response("Not found", { status: 404 });
    const source = this.sourceFor(pipe);
    if (source.kind !== "custom" || source.origin !== "cloudflare" || !source.tail?.signingSecret) return new Response("Not found", { status: 404 });
    const timestamp = headers.get("x-factorize-timestamp") ?? "", delivery = headers.get("x-factorize-delivery") ?? "", signature = headers.get("x-factorize-signature") ?? "";
    const metadataEvent = { type: "tail", action: "delivery" };
    if (!timestamp || !delivery || !signature) { this.recordFlowEvent(pipe, delivery || "missing", null, null, metadataEvent, "invalid", "Tail delivery metadata was missing.", "cloudflare"); return new Response("Missing delivery metadata", { status: 400 }); }
    const verification = await verifyTailDelivery(source.tail.signingSecret, timestamp, delivery, raw, signature);
    if (verification !== "valid") { this.recordFlowEvent(pipe, delivery, null, null, metadataEvent, verification, verification === "stale" ? "Tail delivery timestamp was stale." : "Tail delivery signature was invalid.", "cloudflare"); return new Response(verification === "stale" ? "Stale delivery" : "Invalid signature", { status: 401 }); }
    if (this.one("SELECT id FROM deliveries WHERE id=?", `cloudflare:${delivery}`)) { this.recordFlowEvent(pipe, delivery, null, null, metadataEvent, "duplicate", "Tail delivery ID was already processed.", "cloudflare"); return new Response("Duplicate delivery", { status: 409 }); }
    let parsed: Record<string, any>; try { parsed = JSON.parse(raw); } catch { this.recordFlowEvent(pipe, delivery, null, null, metadataEvent, "invalid", "Tail delivery was not valid JSON.", "cloudflare"); return new Response("Invalid JSON", { status: 400 }); }
    const event = sanitizeTailEvent(parsed) as Record<string, any>;
    this.ctx.storage.sql.exec("INSERT INTO deliveries (id,pipe_id,received_at) VALUES (?,?,?)", `cloudflare:${delivery}`, pipe.id, now());
    if (suppressTailEvent(event)) { this.recordFlowEvent(pipe, delivery, null, null, metadataEvent, "rejected", "Tail delivery was suppressed to prevent a Factorize ingestion loop.", "cloudflare"); return new Response(null, { status: 202 }); }
    const fingerprint = await tailFingerprint(event), windowMs = 5 * 60_000, limit = 5;
    const seen = this.one("SELECT * FROM tail_fingerprints WHERE flow_id=? AND fingerprint=?", pipe.id, fingerprint) as Row | undefined;
    if (seen && Date.now() - Number(seen.window_started) < windowMs && Number(seen.count) >= limit) { this.ctx.storage.sql.exec("UPDATE tail_fingerprints SET count=count+1 WHERE flow_id=? AND fingerprint=?", pipe.id, fingerprint); this.recordFlowEvent(pipe, delivery, null, null, metadataEvent, "rate_limited", "Repeated Tail event fingerprint exceeded the per-flow limit.", "cloudflare"); return new Response("Rate limited", { status: 429 }); }
    if (!seen || Date.now() - Number(seen.window_started) >= windowMs) this.ctx.storage.sql.exec("INSERT INTO tail_fingerprints VALUES (?,?,?,1) ON CONFLICT(flow_id,fingerprint) DO UPDATE SET window_started=excluded.window_started,count=1", pipe.id, fingerprint, Date.now());
    else this.ctx.storage.sql.exec("UPDATE tail_fingerprints SET count=count+1 WHERE flow_id=? AND fingerprint=?", pipe.id, fingerprint);
    await this.evaluateCustom(pipe, "cloudflare", delivery, event);
    await this.ctx.storage.setAlarm(Date.now());
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
    const prompt = renderSourcePrompt(source, String(pipe.context_template || DEFAULT_CONTEXT_TEMPLATE), payload, String(pipe.name), deliveryId);
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
      const pipe = this.one("SELECT * FROM pipes WHERE id=?", verification.flow_id) as Row | undefined;
      if (!pipe) { this.ctx.storage.sql.exec("DELETE FROM pending_verifications WHERE id=?", verification.id); continue; }
      const installation = this.one("SELECT state FROM github_installations WHERE installation_id=?", verification.installation_id) as Row | undefined;
      if (installation?.state !== "active") { this.finishVerification(verification, pipe, "verification_failed", "GitHub installation is disconnected."); continue; }
      try {
        const token = await installationToken(this.env, Number(verification.installation_id));
        const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(String(verification.repository_owner))}/${encodeURIComponent(String(verification.repository_name))}/pulls/${verification.pull_number}`, { headers: githubHeaders(token) });
        if (response.status === 404) { this.finishVerification(verification, pipe, "ignored", "Pull request no longer exists or is inaccessible."); continue; }
        const rateLimited = response.status === 429 || (response.status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after")));
        if (response.status === 401 || (response.status === 403 && !rateLimited)) { this.finishVerification(verification, pipe, "verification_failed", `GitHub access failed permanently (${response.status}).`); continue; }
        if (!response.ok) { await this.retryVerification(verification, pipe, delays, `Transient GitHub API failure (${response.status}).`, rateLimited ? Number(response.headers.get("retry-after")) * 1000 : undefined); continue; }
        const pull = await response.json() as any;
        if (pull.state !== "open" || pull.base?.ref !== "main") { this.finishVerification(verification, pipe, "ignored", "Pull request is closed or no longer targets main."); continue; }
        if (pull.mergeable === null) { await this.retryVerification(verification, pipe, delays, "GitHub is still calculating mergeability."); continue; }
        if (pull.mergeable === true) { this.finishVerification(verification, pipe, "ignored", "GitHub reports that the pull request is mergeable."); continue; }
        const source = this.sourceFor(pipe);
        if (source.kind !== "github" || source.repositoryId !== Number(verification.repository_id)) { this.finishVerification(verification, pipe, "ignored", "Flow source changed while verification was pending."); continue; }
        const saved = JSON.parse(String(verification.payload));
        const workItem: WorkItem = { provider: "github", claimKey: githubClaimKey(source.repositoryId, pull.number), identifier: `${source.repositoryFullName}#${pull.number}`, title: pull.title ?? saved.title, description: pull.body ?? saved.body, url: pull.html_url, event: { type: "pull_request", name: "pull_request", action: "dequeued", delivery: verification.delivery_id }, repository: { id: source.repositoryId, owner: source.repositoryOwner, name: source.repositoryName, fullName: source.repositoryFullName }, pullRequest: { number: pull.number, url: pull.html_url, title: pull.title ?? "", body: pull.body ?? "", author: pull.user?.login ?? "", base: { ref: pull.base.ref, sha: pull.base.sha }, head: { ref: pull.head?.ref ?? "", sha: pull.head?.sha ?? "", repository: pull.head?.repo?.full_name ?? "" } } };
        this.ctx.storage.sql.exec("DELETE FROM pending_verifications WHERE id=?", verification.id);
        await this.queueWorkItem(pipe, String(verification.delivery_id), workItem, renderGitHubPrompt(workItem, { id: String(pipe.id), name: String(pipe.name) }));
      } catch (error) { await this.retryVerification(verification, pipe, delays, error instanceof Error ? error.message : "GitHub verification failed."); }
    }
  }

  private async retryVerification(verification: Row, pipe: Row, delays: number[], detail: string, overrideDelay?: number): Promise<void> {
    const nextAttempt = Number(verification.attempt) + 1;
    if (nextAttempt >= delays.length) { this.finishVerification(verification, pipe, "verification_failed", `Verification retries exhausted: ${detail}`); return; }
    const delay = Math.max(delays[nextAttempt]!, Number.isFinite(overrideDelay) ? overrideDelay! : 0);
    this.ctx.storage.sql.exec("UPDATE pending_verifications SET attempt=?,next_attempt_at=? WHERE id=?", nextAttempt, Date.now() + delay, verification.id);
    this.recordFlowEvent(pipe, String(verification.delivery_id), githubClaimKey(Number(verification.repository_id), Number(verification.pull_number)), null, { type: "pull_request", action: "dequeued" }, "waiting", detail, "github");
  }

  private finishVerification(verification: Row, pipe: Row, outcome: string, detail: string): void {
    this.ctx.storage.sql.exec("DELETE FROM pending_verifications WHERE id=?", verification.id);
    this.recordFlowEvent(pipe, String(verification.delivery_id), githubClaimKey(Number(verification.repository_id), Number(verification.pull_number)), null, { type: "pull_request", action: "dequeued" }, outcome, detail, "github");
  }

  private async startRun(run: Row, pipe: Row): Promise<void> {
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
    const pipe = this.one("SELECT * FROM pipes WHERE id = ?", run.pipe_id) as Row | undefined;
    if (!pipe) return this.finishRun(run, "failed", "Flow configuration is unavailable.");
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
    const encryptedResult = await encrypt(result, this.env.CREDENTIAL_ENCRYPTION_KEY);
    this.ctx.storage.sql.exec("UPDATE runs SET state = ?, result = ?, output_captured=?, updated_at = ? WHERE id = ?", state, encryptedResult, outputCaptured ? 1 : Number(run.output_captured || 0), now(), run.id);
    this.ctx.storage.sql.exec("DELETE FROM active_claims WHERE pipe_id = ? AND issue_id = ?", run.pipe_id, run.claim_key || run.issue_id);
    this.ctx.storage.sql.exec("UPDATE runs SET claim_released=1 WHERE id=?", run.id);
    await this.collectRunPane({ ...run, state, output_captured: outputCaptured ? 1 : Number(run.output_captured || 0), claim_released: 1 });
    const heading = state === "done" ? "Factorize completed the agent run." : "Factorize could not complete the agent run.";
    if (String(run.provider || "linear") === "linear") await this.safeLinearComment(String(run.issue_id), `${heading}\n\nRun ID: \`${run.id}\`. Review the Herdr session on the configured VM for details.`);
  }

  private async collectRunPane(run: Row): Promise<void> {
    if (!['done', 'failed', 'cancelled'].includes(String(run.state)) || !Number(run.output_captured) || !Number(run.claim_released) || !run.herdr_pane_id || !run.herdr_terminal_id || !run.worktree_path || !run.ownership_lease) return;
    const pipe = this.one("SELECT * FROM pipes WHERE id=?", run.pipe_id) as Row | undefined;
    const connection = pipe ? await this.connectionForPipe(pipe) : null;
    if (!connection) return;
    const collected = await exec(connection, garbageCollectPaneCommand(connection, String(run.herdr_pane_id), String(run.herdr_terminal_id), String(run.worktree_path), String(run.ownership_lease)));
    this.commandActivity(run.id, "pane garbage collection", collected);
    if (collected.ok && (collected.exitCode === null || collected.exitCode === 0)) this.ctx.storage.sql.exec("UPDATE runs SET pane_collected=1,worktree_disposition='retained',updated_at=? WHERE id=?", now(), run.id);
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
      const valid = validateCustomHandler(source.origin, source.handlerName, source.handlerCode);
      if (!source.handlerDeployment || source.handlerDeployment.state !== "ready" || !/^fh-[a-f0-9]{40}$/.test(source.handlerDeployment.scriptName) || !/^[a-f0-9]{64}$/.test(source.handlerDeployment.codeDigest)) throw new Error("Custom handler deployment is not ready.");
      if (valid.origin === "cloudflare" && (!source.tail?.signingSecret || source.tail.signingSecret.length < 32)) throw new Error("Cloudflare Tail signing is not configured.");
      return { kind: "custom", ...valid, handlerDeployment: source.handlerDeployment, ...(valid.origin === "cloudflare" ? { tail: source.tail } : {}) };
    }
    if (this.env.GITHUB_INTEGRATION_ENABLED !== "true") throw new Error("GitHub integration is not enabled");
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
    const rules = Array.isArray(input.matchRules) && input.matchRules.length ? input.matchRules : input.filterType && input.filterTargetId ? [{ type: input.filterType, targetId: input.filterTargetId }] : [];
    const validTypes: FilterType[] = ["owner", "creator", "status", "label", "assignee"];
    if (!rules.length) throw new Error("Configure at least one issue matching rule.");
    if (!rules.every((rule) => rule && validTypes.includes(rule.type) && typeof rule.targetId === "string" && rule.targetId.trim())) throw new Error("Each matching rule needs a supported type and target.");
    return rules.map((rule) => ({ type: rule.type, targetId: rule.targetId.trim() }));
  }

  private savedMatchRules(pipe: Row): MatchRule[] {
    try {
      const parsed = JSON.parse(String(pipe.match_rules || "[]"));
      if (Array.isArray(parsed) && parsed.length) return this.matchRules({ name: "", projectId: "", matchRules: parsed, maxConcurrency: 1 });
    } catch { /* Pre-migration flows fall back to their legacy single rule. */ }
    return this.matchRules({ name: "", projectId: "", filterType: pipe.filter_type as FilterType, filterTargetId: String(pipe.filter_target_id), maxConcurrency: 1 });
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
