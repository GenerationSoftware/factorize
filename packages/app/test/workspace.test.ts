import { describe, expect, it } from "vitest";
import { agentStatusCommand, connectionCheckCommand, defaultAgentCommand, garbageCollectPaneCommand, herdrAgentStatus, launchAgentCommand, promptAgentCommand, replaceForegroundCommand, shellAtom, startAgentCommand } from "../src/exe";
import { workingDirectoryFor, workspaceNameFor } from "../src/workspace";

describe("flow workspaces", () => {
  it("uses a harmless SSH round trip for connection tests", () => {
    expect(connectionCheckCommand()).toBe("printf '%s\\n' factorize-connection-ok");
  });

  it("derives a stable Herdr workspace label from a flow name", () => {
    expect(workspaceNameFor("Bug fixes / API")).toBe("bug-fixes-api");
    expect(workspaceNameFor("!!!")).toBe("flow");
  });

  it("renders a flow-specific working directory from its flow ID", () => {
    expect(workingDirectoryFor("/repos/{{{flowId}}}", "bug-fixes")).toBe("/repos/bug-fixes");
    expect(workingDirectoryFor("/repos/shared", "bug-fixes")).toBe("/repos/shared");
  });

  it("passes the saved flow workspace to Herdr", () => {
    const command = startAgentCommand("bug-fixes-a1b2c3d4", { vmName: "vm", apiToken: "token", agentKind: "codex", cwd: "/repo" }, "fix it", "bug-fixes", "/repo/.factorize-runs/run-1", "lease-1");
    expect(command).toContain("--label 'bug-fixes'");
    expect(command).toContain("mkdir '/repo/.factorize-runs/run-1'");
    expect(command).not.toContain("git worktree");
    expect(command).toContain("tab list --workspace");
    expect(command).toContain("tab create --workspace");
    expect(command).toContain("tab rename \"$tab_id\" 'bug-fixes-a1b2c3d4'");
    expect(command).not.toContain("pane split");
    expect(command).toContain("--no-focus");
    expect(command).not.toContain("__FACTORIZE_EXIT_CODE__");
    expect(command).toContain('export PATH="$HOME/.local/bin:$PATH"');
    expect(command).not.toContain("-- 'codex'");
    expect(command).toContain("agent get 'bug-fixes-a1b2c3d4'");
    expect(command).not.toContain("/new");
    expect(command).toContain("-- '--dangerously-bypass-approvals-and-sandbox'");
  });

  it("keeps harness launch separate from prompt delivery", () => {
    const connection = { vmName: "vm", apiToken: "token", agentKind: "codex", cwd: "/repo" };
    const launch = launchAgentCommand("factorize-1", connection, "factorize", "/repo/.factorize-runs/run", "lease");
    const delivery = promptAgentCommand(connection, "factorize-1", "fix it");
    expect(launch).toContain("agent start 'factorize-1'");
    expect(launch).not.toContain("agent prompt");
    expect(delivery).toContain("agent prompt 'factorize-1'");
    expect(delivery).not.toContain("agent start");
  });

  it("never skips prompt delivery when an idempotent launch finds an agent", () => {
    const command = startAgentCommand("factorize-1", { vmName: "vm", apiToken: "token", agentKind: "codex", cwd: "/repo" }, "fix it", "factorize", "/repo/.factorize-runs/run", "lease");
    expect(command.indexOf("agent prompt 'factorize-1'")).toBeGreaterThan(command.indexOf("existing="));
    expect(command).not.toMatch(/then printf[^;]+; else[^;]+agent prompt/);
  });

  it("uses no-prompt defaults for Codex and Claude, but leaves Pi unchanged", () => {
    expect(defaultAgentCommand("codex")).toBe("--dangerously-bypass-approvals-and-sandbox");
    expect(defaultAgentCommand("claude")).toBe("--dangerously-skip-permissions");
    expect(defaultAgentCommand("pi")).toBe("");
  });

  it("passes a configured agent command as safely quoted arguments", () => {
    const command = startAgentCommand("factorize-1", { vmName: "vm", apiToken: "token", agentKind: "codex", cwd: "/repo", agentCommand: "--model 'gpt 5'" }, "fix it", "factorize", "/repo/.factorize-runs/run", "lease");
    expect(command).toContain("-- '--model' 'gpt 5'");
  });

  it("garbage collects only after terminal, run directory, and lease revalidation", () => {
    const command = garbageCollectPaneCommand({ vmName: "vm", apiToken: "token", agentKind: "codex", cwd: "/repo" }, "w1:p2", "term-7", "/repo/.factorize-runs/run", "lease-7");
    expect(command).toContain(".terminal_id == $terminal");
    expect(command).toContain("factorize-lease");
    expect(command).not.toContain("agent stop");
    expect(command).toContain("pane close 'w1:p2'");
  });

  it("quotes the complete exe.dev SSH request body", () => {
    const command = "cd '/repo' && herdr status --json";
    expect(`ssh ${shellAtom("exedev@vm")} ${shellAtom(command)}`).toContain("ssh 'exedev@vm'");
  });

  it("makes the user-local Herdr binary available to non-interactive VM commands", () => {
    const command = agentStatusCommand({ vmName: "vm", apiToken: "token", agentKind: "codex", cwd: "/repo" }, "factorize-1");
    expect(command).toContain('export PATH="$HOME/.local/bin:$PATH"');
    expect(command).toContain("command -v 'herdr' >/dev/null");
  });

  it("reads Herdr's current agent_status response field", () => {
    expect(herdrAgentStatus('{"result":{"agent":{"agent_status":"working"}}}')).toBe("working");
    expect(herdrAgentStatus('{"result":{"agent":{"state":"idle"}}}')).toBe("idle");
  });

  it("revalidates exact pane and process identities before bounded escalation", () => {
    const command = replaceForegroundCommand("flow-1", { vmName: "vm", apiToken: "token", agentKind: "codex", cwd: "/repo" }, "pane-7");
    expect(command.match(/pane process-info --pane 'pane-7'/g)).toHaveLength(2);
    expect(command).toContain('second_pid" = "$first_pid');
    expect(command).toContain('second_pgid" = "$first_pgid');
    expect(command).toContain('kill -INT -- "-$first_pgid"');
    expect(command).toContain('kill -TERM -- "-$first_pgid"');
    expect(command).not.toContain("pkill");
  });
});
