export interface HerdrIdentity { name: string; status: string; kind: string; workspaceId: string; paneId: string; terminalId: string; cwd: string; sessionSource: string; sessionKind: string; sessionValue: string; }
export interface PaneProcess { paneId: string; pid: number; processGroup: number; argv: string[]; executable: string; cwd: string; }
const obj = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const str = (...values: unknown[]) => String(values.find((value) => typeof value === "string" || typeof value === "number") ?? "");
function identity(value: unknown): HerdrIdentity | null {
  const wrapper = obj(value), agent = wrapper.agent && typeof wrapper.agent === "object" ? obj(wrapper.agent) : wrapper, session = obj(agent.session_identity ?? agent.agent_session ?? agent.session), source = obj(session.source);
  const result = { name: str(agent.name, agent.agent_name), status: str(agent.agent_status, agent.status, agent.state).toLowerCase(), kind: str(agent.agent_kind, agent.kind, agent.agent), workspaceId: str(agent.workspace_id, obj(agent.workspace).id), paneId: str(agent.pane_id, obj(agent.pane).id), terminalId: str(agent.terminal_id, obj(agent.terminal).id), cwd: str(agent.cwd), sessionSource: typeof session.source === "string" ? session.source : str(agent.session_source), sessionKind: str(session.kind, source.kind, agent.session_kind), sessionValue: str(session.value, session.id, source.value, agent.session_id, agent.session_value) };
  return result.name || result.paneId || result.sessionValue ? result : null;
}
function jsonObjects(body: string): Record<string, any>[] {
  const values: Record<string, any>[] = [];
  let start = -1, depth = 0, quoted = false, escaped = false;
  for (let index = 0; index < body.length; index++) {
    const char = body[index]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"' && depth > 0) { quoted = true; continue; }
    if (char === "{") { if (depth++ === 0) start = index; continue; }
    if (char === "}" && depth > 0 && --depth === 0 && start >= 0) {
      try { values.push(obj(JSON.parse(body.slice(start, index + 1)))); } catch { /* ignore non-JSON output */ }
      start = -1;
    }
  }
  return values;
}
export function parseAgent(body: string): HerdrIdentity | null { for (const parsed of jsonObjects(body).reverse()) { const found = identity(obj(parsed.result).agent ?? parsed.agent ?? parsed.result ?? parsed); if (found) return found; } return null; }
export function parseAgentList(body: string): HerdrIdentity[] { for (const parsed of jsonObjects(body).reverse()) { const result = obj(parsed.result); const values = Array.isArray(result.agents) ? result.agents : Array.isArray(parsed.agents) ? parsed.agents : Array.isArray(parsed.result) ? parsed.result : []; const agents = values.map(identity).filter((value): value is HerdrIdentity => value !== null); if (agents.length || values.length) return agents; } return []; }
export function sameStableSession(saved: Partial<HerdrIdentity>, live: HerdrIdentity): boolean { return Boolean(saved.sessionValue && live.sessionValue && saved.sessionValue === live.sessionValue && (!saved.sessionKind || !live.sessionKind || saved.sessionKind === live.sessionKind)); }
export function matchesLineage(saved: Partial<HerdrIdentity>, live: HerdrIdentity): boolean { return Boolean((saved.terminalId && saved.terminalId === live.terminalId) || (saved.paneId && saved.paneId === live.paneId && (!saved.workspaceId || !live.workspaceId || saved.workspaceId === live.workspaceId))); }
export function safeToAdopt(saved: Partial<HerdrIdentity>, live: HerdrIdentity, claimedSessions: Set<string>): boolean { return matchesLineage(saved, live) && (!saved.kind || saved.kind === live.kind) && (!saved.cwd || saved.cwd === live.cwd) && !claimedSessions.has(live.sessionValue); }
/** Native sessions and aliases may rotate; terminal + worktree own the pane. */
export function ownsPane(saved: Partial<HerdrIdentity>, live: HerdrIdentity, worktreePath: string): boolean {
  return Boolean(saved.terminalId && saved.terminalId === live.terminalId && worktreePath && live.cwd === worktreePath && (!saved.paneId || saved.paneId === live.paneId));
}
export function findOwnedAgent(saved: Partial<HerdrIdentity>, agents: HerdrIdentity[], worktreePath: string, expectedName: string, expectedKind: string, runId: string): HerdrIdentity | undefined {
  const runPath = (cwd: string) => cwd.includes(`/.factorize-runs/${runId}`) || cwd.includes(`/.factorize-worktrees/${runId}`);
  return agents.find((agent) => ownsPane(saved, agent, worktreePath)) ?? agents.find((agent) => agent.name === expectedName && (!expectedKind || agent.kind === expectedKind) && (agent.cwd === worktreePath || runPath(agent.cwd)));
}
export function parsePaneProcess(body: string): PaneProcess | null { try { const parsed = obj(JSON.parse(body)), result = obj(parsed.result), foreground = obj(result.foreground ?? result.process ?? parsed.foreground ?? parsed); const pane = obj(result.pane); const pid = Number(foreground.pid ?? result.pid), processGroup = Number(foreground.process_group ?? foreground.pgid ?? result.process_group ?? result.pgid); if (!Number.isSafeInteger(pid) || pid <= 1 || !Number.isSafeInteger(processGroup) || processGroup <= 1) return null; return { paneId: str(result.pane_id, pane.pane_id, pane.id, parsed.pane_id), pid, processGroup, argv: Array.isArray(foreground.argv) ? foreground.argv.map(String) : [], executable: str(foreground.executable, foreground.exe), cwd: str(foreground.cwd, result.cwd) }; } catch { return null; } }
