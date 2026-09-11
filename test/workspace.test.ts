import { describe, expect, it } from "vitest";
import { agentStatusCommand, defaultAgentCommand, herdrAgentStatus, shellAtom, startAgentCommand } from "../src/exe";
import { workspaceNameFor } from "../src/workspace";

describe("flow workspaces", () => {
  it("derives a stable Herdr workspace label from a flow name", () => {
    expect(workspaceNameFor("Bug fixes / API")).toBe("bug-fixes-api");
    expect(workspaceNameFor("!!!")).toBe("flow");
  });

  it("passes the saved flow workspace to Herdr", () => {
    const command = startAgentCommand("bug-fixes-1", { vmName: "vm", apiToken: "token", agentKind: "codex", cwd: "/repo" }, "fix it", "bug-fixes-1");
    expect(command).toContain("--label 'bug-fixes-1'");
    expect(command).toContain("--no-focus");
    expect(command).not.toContain("__FACTORIZE_EXIT_CODE__");
    expect(command).toContain('export PATH="$HOME/.local/bin:$PATH"');
    expect(command).not.toContain("-- 'codex'");
    expect(command).toContain("agent get 'bug-fixes-1'");
    expect(command).toContain('idle|done');
    expect(command).toContain("agent prompt 'bug-fixes-1' '/new'");
    expect(command).toContain("-- '--dangerously-bypass-approvals-and-sandbox'");
  });

  it("uses no-prompt defaults for Codex and Claude, but leaves Pi unchanged", () => {
    expect(defaultAgentCommand("codex")).toBe("--dangerously-bypass-approvals-and-sandbox");
    expect(defaultAgentCommand("claude")).toBe("--dangerously-skip-permissions");
    expect(defaultAgentCommand("pi")).toBe("");
  });

  it("passes a configured agent command as safely quoted arguments", () => {
    const command = startAgentCommand("factorize-1", { vmName: "vm", apiToken: "token", agentKind: "codex", cwd: "/repo", agentCommand: "--model 'gpt 5'" }, "fix it");
    expect(command).toContain("-- '--model' 'gpt 5'");
  });

  it("quotes the complete exe.dev SSH request body", () => {
    const command = "cd '/repo' && herdr status --json";
    expect(`ssh ${shellAtom("exedev@vm")} ${shellAtom(command)}`).toContain("ssh 'exedev@vm'");
  });

  it("makes the user-local Herdr binary available to non-interactive VM commands", () => {
    expect(agentStatusCommand({ vmName: "vm", apiToken: "token", agentKind: "codex", cwd: "/repo" }, "factorize-1")).toContain('export PATH="$HOME/.local/bin:$PATH"');
  });

  it("reads Herdr's current agent_status response field", () => {
    expect(herdrAgentStatus('{"result":{"agent":{"agent_status":"working"}}}')).toBe("working");
    expect(herdrAgentStatus('{"result":{"agent":{"state":"idle"}}}')).toBe("idle");
  });
});
