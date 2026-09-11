import { DurableObject } from "cloudflare:workers";
import Mustache from "mustache";
import { decrypt, encrypt } from "./crypto";
import { agentOutputCommand, agentStatusCommand, connectionCheckCommand, defaultAgentCommand, exec, herdrAgentStatus, herdrCheckCommand, startAgentCommand, type ExeConnection } from "./exe";
import { LINEAR_ISSUE_PROJECT_QUERY, LINEAR_OPTION_QUERIES, LINEAR_PROJECTS_QUERY } from "./linear";
import { matchingIssue } from "./matcher";
import type { Env, ExeConnectionInput, FilterType, MatchRule, PipeInput, RunState } from "./types";
import { workspaceNameFor } from "./workspace";

type Row = Record<string, unknown>;
const json = (value: unknown) => Response.json(value);
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const HERDR_FLOW_NAME = /^[a-z][a-z0-9_-]{0,29}$/;

const object = (value: unknown): Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const text = (value: unknown): string => typeof value === "string" ? value : "";
/** The initial per-flow template. It intentionally mirrors Factorize's former prompt. */
export const DEFAULT_CONTEXT_TEMPLATE = `---
pipe: "{{{flow.name}}}"
issue: "{{{ticket.identifier}}}"
url: "{{{ticket.url}}}"
{{#ticket.project.name}}project: "{{{ticket.project.name}}}"
{{/ticket.project.name}}{{#ticket.labels.length}}labels: [{{#ticket.labels}}"{{{name}}}"{{^last}}, {{/last}}{{/ticket.labels}}]
{{/ticket.labels.length}}{{#ticket.assignee.name}}owner: "{{{ticket.assignee.name}}}"
{{/ticket.assignee.name}}{{#ticket.state.name}}status: "{{{ticket.state.name}}}"
{{/ticket.state.name}}---

# {{{ticket.title}}}

{{{ticket.description}}}`;

/**
 * Render an agent prompt from the complete Linear webhook payload. `ticket` is
 * a normalized convenience alias; the original payload keys remain available.
 */
export function renderContextTemplate(template: string, payload: Record<string, unknown>, pipeName: string): string {
  const issue = object(payload.issue);
  // Issue webhooks put fields directly on data; IssueLabel events use the fetched
  // linked issue under `issue`.
  const ticket = text(issue.title) || text(issue.description) ? issue : payload;
  const project = object(ticket.project);
  const assignee = object(ticket.assignee);
  const state = object(ticket.state);
  const labelsValue = object(ticket.labels);
  const rawLabels = Array.isArray(ticket.labels) ? ticket.labels : Array.isArray(labelsValue.nodes) ? labelsValue.nodes : [];
  const labels = rawLabels.map((label) => text(object(label).name)).filter(Boolean);
  const normalizedTicket = {
    ...ticket,
    id: text(ticket.id),
    identifier: text(ticket.identifier) || text(ticket.id),
    url: text(ticket.url),
    title: text(ticket.title) || "Untitled Linear issue",
    description: text(ticket.description).trim() || "No description provided.",
    project,
    assignee,
    state,
    labels: labels.map((name, index) => ({ name, last: index === labels.length - 1 })),
  };
  return Mustache.render(template || DEFAULT_CONTEXT_TEMPLATE, {
    ...payload,
    ticket: normalizedTicket,
    flow: { name: pipeName },
  });
}

/** @deprecated Use renderContextTemplate with a flow's saved template. */
export const linearTicketPrompt = (payload: Record<string, unknown>, pipeName: string) => renderContextTemplate(DEFAULT_CONTEXT_TEMPLATE, payload, pipeName);

export class Tenant extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
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
    `);
    this.ensureColumn("pipes", "workspace_name", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("pipes", "agent_kind", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("pipes", "context_template", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("pipes", "match_rules", "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn("pipes", "exe_connection_id", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("pipes", "cwd", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("flow_events", "issue_url", "TEXT");
    this.ensureColumn("runs", "issue_url", "TEXT");
    this.ensureColumn("runs", "workspace_name", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("runs", "agent_kind", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("runs", "exec_request", "TEXT");
    this.ensureColumn("runs", "exec_response", "TEXT");
    this.ensureColumn("runs", "exec_status", "INTEGER");
    this.ensureColumn("runs", "exec_exit_code", "INTEGER");
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/pipes") return json(this.rows("SELECT id, name, project_id, team_id, filter_type, filter_target_id, max_concurrency, workspace_name, agent_kind, enabled, created_at FROM pipes ORDER BY created_at DESC"));
      if (request.method === "GET" && url.pathname.startsWith("/pipes/")) return await this.flowDetail(url.pathname.split("/")[2] ?? "");
      if (request.method === "GET" && url.pathname === "/runs") return json(this.rows("SELECT id, pipe_id, issue_id, agent_name, state, created_at, updated_at FROM runs ORDER BY created_at DESC LIMIT 100"));
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
      if (request.method === "POST" && url.pathname === "/webhook") return await this.acceptWebhook(await request.json() as Record<string, any>, request.headers.get("linear-delivery"));
      return new Response("Not found", { status: 404 });
    } catch (error) {
      console.error("Tenant request failed", error);
      return Response.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 400 });
    }
  }

  async alarm(): Promise<void> {
    // Release completed slots before looking at the queue, so capacity is used
    // immediately rather than waiting for the next polling alarm.
    const running = this.rows("SELECT * FROM runs WHERE state IN ('running','blocked') ORDER BY updated_at LIMIT 40");
    for (const run of running) await this.pollRun(run);
    const queued = this.rows("SELECT * FROM runs WHERE state = 'queued' ORDER BY created_at LIMIT 20");
    for (const run of queued) {
      const pipe = this.one("SELECT * FROM pipes WHERE id = ?", run.pipe_id) as Row | undefined;
      if (!pipe) continue;
      const active = this.one("SELECT count(*) AS count FROM runs WHERE pipe_id = ? AND state IN ('starting','running','blocked')", pipe.id) as Row;
      if (Number(active.count) >= Number(pipe.max_concurrency)) continue;
      const slot = this.nextRunSlot(pipe, String(run.id));
      const name = `${String(pipe.workspace_name)}-${slot}`;
      this.ctx.storage.sql.exec("UPDATE runs SET state = 'starting', agent_name = ?, workspace_name = ?, updated_at = ? WHERE id = ? AND state = 'queued'", name, name, now(), run.id);
      await this.startRun({ ...run, agent_name: name, workspace_name: name }, pipe);
    }

    const pending = this.one("SELECT count(*) AS count FROM runs WHERE state IN ('queued','starting','running','blocked')") as Row;
    if (Number(pending.count) > 0) await this.ctx.storage.setAlarm(Date.now() + 15_000);
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
    const rules = this.matchRules(input);
    if (!input.name || !input.projectId) throw new Error("Pipe name and project are required");
    const flowId = this.flowId(input.flowId, input.name);
    // Rules are validated above; legacy columns mirror the first rule.
    const requestedConcurrency = Number(input.maxConcurrency);
    const maxConcurrency = Math.max(0, Math.min(50, Math.floor(Number.isFinite(requestedConcurrency) ? requestedConcurrency : 3)));
    const pipeId = id();
    const linear = await this.connection<{ accessToken: string }>("linear");
    if (!linear) throw new Error("Connect Linear first");
    const exe = await this.exeConnection(input.exeConnectionId);
    if (!exe) throw new Error("Connect Herdr first");
    if (!input.cwd) throw new Error("Choose a working directory.");
    const workspaceName = flowId;
    // These legacy fields are retained for compatibility with the v1 Durable Object schema.
    // App-wide webhook verification is performed at the Worker edge before reaching this object.
    this.ctx.storage.sql.exec(
      "INSERT INTO pipes (id,name,project_id,team_id,filter_type,filter_target_id,max_concurrency,capability,webhook_id,signing_secret,workspace_name,agent_kind,context_template,match_rules,exe_connection_id,cwd,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      pipeId, input.name, input.projectId, "", rules[0].type, rules[0].targetId, maxConcurrency, "app-webhook", null, "app-webhook", workspaceName, exe.agentKind, this.contextTemplate(input.contextTemplate), JSON.stringify(rules), input.exeConnectionId || "default", input.cwd, now(),
    );
    return Response.json({ id: pipeId }, { status: 201 });
  }

  private async updatePipe(pipeId: string, input: PipeInput): Promise<Response> {
    if (!pipeId || !this.one("SELECT id FROM pipes WHERE id = ?", pipeId)) return new Response("Not found", { status: 404 });
    const rules = this.matchRules(input);
    if (!input.name || !input.projectId) throw new Error("Pipe name and project are required");
    const flowId = this.flowId(input.flowId, input.name);
    const requestedConcurrency = Number(input.maxConcurrency);
    const maxConcurrency = Math.max(0, Math.min(50, Math.floor(Number.isFinite(requestedConcurrency) ? requestedConcurrency : 3)));
    const workspaceName = flowId;
    const exe = await this.exeConnection(input.exeConnectionId);
    if (!exe) throw new Error("Choose an exe.dev connection.");
    if (!input.cwd) throw new Error("Choose a working directory.");
    this.ctx.storage.sql.exec(
      "UPDATE pipes SET name=?, project_id=?, filter_type=?, filter_target_id=?, max_concurrency=?, workspace_name=?, agent_kind=?, context_template=?, match_rules=?, exe_connection_id=?, cwd=? WHERE id=?",
      input.name, input.projectId, rules[0].type, rules[0].targetId, maxConcurrency, workspaceName, exe.agentKind, this.contextTemplate(input.contextTemplate), JSON.stringify(rules), input.exeConnectionId || "default", input.cwd, pipeId,
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

  private async flowDetail(flowId: string): Promise<Response> {
    const flow = this.one("SELECT id, name, project_id, filter_type, filter_target_id, match_rules, max_concurrency, workspace_name, agent_kind, exe_connection_id, cwd, COALESCE(NULLIF(context_template, ''), ?) AS context_template, enabled, created_at FROM pipes WHERE id = ?", DEFAULT_CONTEXT_TEMPLATE, flowId);
    if (!flow) return new Response("Not found", { status: 404 });
    const events = this.rows("SELECT id, delivery_id, issue_id, issue_url, event_type, event_action, outcome, detail, received_at FROM flow_events WHERE flow_id = ? ORDER BY received_at DESC LIMIT 100", flowId);
    const runs = this.rows("SELECT id, issue_id, issue_url, agent_name, workspace_name, agent_kind, state, prompt, result, created_at, updated_at, exec_request, exec_response, exec_status, exec_exit_code FROM runs WHERE pipe_id = ? ORDER BY created_at DESC LIMIT 100", flowId);
    await Promise.all(runs.map(async (run) => {
      if (run.state !== "ignored" && typeof run.prompt === "string" && run.prompt) run.prompt = await decrypt(run.prompt, this.env.CREDENTIAL_ENCRYPTION_KEY);
      if (typeof run.exec_request === "string" && run.exec_request) run.exec_request = await decrypt(run.exec_request, this.env.CREDENTIAL_ENCRYPTION_KEY);
      if (typeof run.exec_response === "string" && run.exec_response) run.exec_response = await decrypt(run.exec_response, this.env.CREDENTIAL_ENCRYPTION_KEY);
      // Duplicate-webhook records predate encrypted results and deliberately retain
      // a plain-text explanation. Only completed/failed agent output is encrypted.
      if (run.state !== "ignored" && typeof run.result === "string" && run.result) run.result = await decrypt(run.result, this.env.CREDENTIAL_ENCRYPTION_KEY);
    }));
    return json({ flow, events, runs });
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

  private async acceptWebhook(event: Record<string, any>, deliveryId: string | null): Promise<Response> {
    if (!deliveryId) return new Response("Missing delivery ID", { status: 400 });
    if (this.one("SELECT id FROM deliveries WHERE id = ?", deliveryId)) return new Response(null, { status: 200 });
    this.ctx.storage.sql.exec("INSERT INTO deliveries (id,pipe_id,received_at) VALUES (?,?,?)", deliveryId, "app-webhook", now());
    let matchingEvent = event;
    let data = matchingEvent.data ?? {};
    let projectId = data.project?.id ?? data.issue?.project?.id;
    const issueId = data.issueId ?? data.issue?.id ?? (matchingEvent.type === "Issue" ? data.id : undefined);
    const pipes = this.rows("SELECT * FROM pipes WHERE enabled = 1");

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
      const issueUrl = this.issueUrl(data, matchingIssueId);
      const runId = id();
      try {
        this.ctx.storage.sql.exec("INSERT INTO active_claims (pipe_id,issue_id,run_id) VALUES (?,?,?)", pipe.id, matchingIssueId, runId);
      } catch {
        this.ctx.storage.sql.exec("INSERT INTO runs (id,pipe_id,issue_id,issue_url,agent_name,workspace_name,agent_kind,state,prompt,result,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", runId, pipe.id, matchingIssueId, issueUrl, `factorize-${runId}`, String(pipe.workspace_name ?? ""), String(pipe.agent_kind ?? ""), "ignored", "", "Ignored: an active run already owns this issue.", now(), now());
        this.recordFlowEvent(pipe, deliveryId, matchingIssueId, issueUrl, matchingEvent, "ignored", "An active or queued run already owns this issue.");
        continue;
      }
      const prompt = await encrypt(renderContextTemplate(String(pipe.context_template || DEFAULT_CONTEXT_TEMPLATE), data, String(pipe.name)), this.env.CREDENTIAL_ENCRYPTION_KEY);
      this.ctx.storage.sql.exec("INSERT INTO runs (id,pipe_id,issue_id,issue_url,agent_name,workspace_name,agent_kind,state,prompt,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)", runId, pipe.id, matchingIssueId, issueUrl, `factorize-${runId}`, String(pipe.workspace_name ?? ""), String(pipe.agent_kind ?? ""), "queued", prompt, now(), now());
      this.recordFlowEvent(pipe, deliveryId, matchingIssueId, issueUrl, matchingEvent, "triggered", "Queued an agent job.");
    }
    await this.ctx.storage.setAlarm(Date.now());
    return new Response(null, { status: 200 });
  }

  private recordFlowEvent(pipe: Row, deliveryId: string, issueId: string | null, issueUrl: string | null, event: Record<string, any>, outcome: "triggered" | "ignored", detail: string): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO flow_events (id,flow_id,delivery_id,issue_id,issue_url,event_type,event_action,outcome,detail,received_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      id(), pipe.id, deliveryId, issueId, issueUrl, String(event.type ?? "unknown"), String(event.action ?? "unknown"), outcome, detail, now(),
    );
  }

  private issueUrl(data: Record<string, any>, issueId: string): string {
    const candidate = typeof data.url === "string" ? data.url : typeof data.issue?.url === "string" ? data.issue.url : "";
    return candidate.startsWith("https://linear.app/") ? candidate : `https://linear.app/issue/${encodeURIComponent(issueId)}`;
  }

  private async startRun(run: Row, pipe: Row): Promise<void> {
    const connection = await this.connectionForPipe(pipe);
    if (!connection) return this.finishRun(run, "failed", "No exe.dev VM is connected.");
    const workspaceName = String(run.workspace_name || pipe.workspace_name || workspaceNameFor(String(pipe.name)));
    await this.postLinearComment(String(run.issue_id), `Factorize started **${connection.agentKind}** on ${connection.vmName} in Herdr workspace \`${workspaceName}\` for this issue.`);
    const prompt = await decrypt(String(run.prompt), this.env.CREDENTIAL_ENCRYPTION_KEY);
    const result = await exec(connection, startAgentCommand(String(run.agent_name), connection, prompt, workspaceName));
    const execRequest = await encrypt(result.requestBody, this.env.CREDENTIAL_ENCRYPTION_KEY);
    const execResponse = await encrypt(result.body, this.env.CREDENTIAL_ENCRYPTION_KEY);
    this.ctx.storage.sql.exec("UPDATE runs SET exec_request = ?, exec_response = ?, exec_status = ?, exec_exit_code = ?, updated_at = ? WHERE id = ?", execRequest, execResponse, result.status, result.exitCode, now(), run.id);
    if (!result.ok || (result.exitCode !== null && result.exitCode !== 0)) return this.finishRun(run, "failed", `Unable to start Herdr agent (exe.dev HTTP ${result.status}, VM exit ${result.exitCode ?? "not reported"}): ${result.body.slice(0, 800)}`);
    const verification = await exec(connection, agentStatusCommand(connection, String(run.agent_name)));
    if (!verification.ok || (verification.exitCode !== null && verification.exitCode !== 0) || !herdrAgentStatus(verification.body)) {
      return this.finishRun(run, "failed", `Herdr agent start returned successfully, but Factorize could not verify the agent (exe.dev HTTP ${verification.status}, VM exit ${verification.exitCode ?? "not reported"}): ${verification.body.slice(0, 800)}`);
    }
    this.ctx.storage.sql.exec("UPDATE runs SET state = 'running', updated_at = ? WHERE id = ?", now(), run.id);
  }

  private async pollRun(run: Row): Promise<void> {
    const pipe = this.one("SELECT * FROM pipes WHERE id = ?", run.pipe_id) as Row | undefined;
    const connection = pipe ? await this.connectionForPipe(pipe) : null;
    if (!connection) return this.finishRun(run, "failed", "exe.dev connection is unavailable.");
    const status = await exec(connection, agentStatusCommand(connection, String(run.agent_name)));
    if (status.exitCode !== null && status.exitCode !== 0) return this.finishRun(run, "failed", `Unable to query the Herdr agent (VM exit ${status.exitCode}): ${status.body.slice(0, 800)}`);
    if (!status.ok) return; // transient VM/API errors are retried by the next alarm
    const agentStatus = herdrAgentStatus(status.body);
    if (agentStatus === "blocked") {
      this.ctx.storage.sql.exec("UPDATE runs SET state = 'blocked', updated_at = ? WHERE id = ?", now(), run.id);
      return;
    }
    if (agentStatus !== "done" && agentStatus !== "idle") return;
    const output = await exec(connection, agentOutputCommand(connection, String(run.agent_name)));
    await this.finishRun(run, "done", output.ok ? output.body.slice(-6000) : "Agent completed; terminal output could not be read.");
  }

  private async finishRun(run: Row, state: Extract<RunState, "done" | "failed">, result: string): Promise<void> {
    const encryptedResult = await encrypt(result, this.env.CREDENTIAL_ENCRYPTION_KEY);
    this.ctx.storage.sql.exec("UPDATE runs SET state = ?, result = ?, updated_at = ? WHERE id = ?", state, encryptedResult, now(), run.id);
    this.ctx.storage.sql.exec("DELETE FROM active_claims WHERE pipe_id = ? AND issue_id = ?", run.pipe_id, run.issue_id);
    const heading = state === "done" ? "Factorize completed the agent run." : "Factorize could not complete the agent run.";
    await this.postLinearComment(String(run.issue_id), `${heading}\n\nRun ID: \`${run.id}\`. Review the Herdr session on the configured VM for details.`);
  }

  private async postLinearComment(issueId: string, body: string): Promise<void> {
    const linear = await this.connection<{ accessToken: string }>("linear");
    if (!linear) return;
    await this.linear(linear.accessToken, "mutation($issueId:String!,$body:String!){ commentCreate(input:{issueId:$issueId,body:$body}){ success } }", { issueId, body });
  }

  private async linear(token: string, query: string, variables: Record<string, unknown>): Promise<any> {
    const response = await fetch("https://api.linear.app/graphql", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });
    const payload = await response.json() as any;
    if (!response.ok || payload.errors?.length) throw new Error(payload.errors?.[0]?.message ?? `Linear request failed (${response.status})`);
    return payload.data;
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
    return connection && pipe.cwd ? { ...connection, cwd: String(pipe.cwd) } : connection;
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
    const active = this.rows("SELECT workspace_name FROM runs WHERE pipe_id = ? AND id != ? AND state IN ('starting','running','blocked')", pipe.id, runId);
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
