import { describe, expect, it } from "vitest";
import { matchesLineage, ownsPane, parseAgent, parseAgentList, parsePaneProcess, safeToAdopt, sameStableSession } from "../src/recovery";

const moved = { name: "renamed", status: "working", kind: "codex", workspaceId: "ws-2", paneId: "pane-2", terminalId: "term-1", cwd: "/repo", sessionSource: "codex", sessionKind: "thread", sessionValue: "session-7" };

describe("Herdr 0.9 recovery identity", () => {
  it("parses representative agent get JSON and trailing structured output", () => {
    const body = `prompt accepted\n${JSON.stringify({ result: { agent: { name: "flow-1", agent_status: "working", agent_kind: "codex", workspace_id: "ws-1", pane_id: "pane-1", terminal_id: "term-1", cwd: "/repo", session_identity: { source: "codex", kind: "thread", value: "session-7" } } } })}`;
    expect(parseAgent(body)).toMatchObject({ name: "flow-1", status: "working", workspaceId: "ws-1", sessionValue: "session-7" });
  });

  it("finds a moved and renamed agent by stable session before location", () => {
    const saved = { sessionKind: "thread", sessionValue: "session-7", paneId: "pane-1", workspaceId: "ws-1" };
    expect(sameStableSession(saved, moved)).toBe(true);
    expect(matchesLineage(saved, moved)).toBe(false);
  });

  it("keeps pane ownership when the native session generation rotates", () => {
    expect(ownsPane({ terminalId: "term-1", paneId: "pane-2", sessionValue: "old" }, { ...moved, sessionValue: "new" }, "/repo")).toBe(true);
    expect(ownsPane({ terminalId: "term-other", paneId: "pane-2" }, moved, "/repo")).toBe(false);
  });

  it("parses agent list arrays", () => {
    const agents = parseAgentList(JSON.stringify({ result: { agents: [{ name: "flow-1", kind: "codex", pane_id: "pane-1", session: { id: "abc" } }] } }));
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ name: "flow-1", paneId: "pane-1", sessionValue: "abc" });
  });

  it("adopts only matching cwd/kind/lineage and unclaimed sessions", () => {
    const saved = { terminalId: "term-1", kind: "codex", cwd: "/repo" };
    expect(safeToAdopt(saved, moved, new Set())).toBe(true);
    expect(safeToAdopt(saved, { ...moved, cwd: "/human" }, new Set())).toBe(false);
    expect(safeToAdopt(saved, { ...moved, kind: "claude" }, new Set())).toBe(false);
    expect(safeToAdopt(saved, moved, new Set(["session-7"]))).toBe(false);
  });

  it("parses exact foreground identity for stale-PID and cwd validation", () => {
    expect(parsePaneProcess(JSON.stringify({ result: { pane_id: "pane-7", foreground: { pid: 401, process_group: 400, argv: ["node", "tool.js"], executable: "/usr/bin/node", cwd: "/repo" } } }))).toEqual({ paneId: "pane-7", pid: 401, processGroup: 400, argv: ["node", "tool.js"], executable: "/usr/bin/node", cwd: "/repo" });
    expect(parsePaneProcess('{"result":{"pid":0,"pgid":0}}')).toBeNull();
  });
});
