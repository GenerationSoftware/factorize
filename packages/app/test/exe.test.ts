import { afterEach, describe, expect, it, vi } from "vitest";
import { agentOutputCommand, exec, launchAgentCommand, modelListCommand, parseModelList, replaceForegroundCommand, startAgentInPaneCommand, stopAgentCommand } from "../src/exe";

afterEach(() => vi.unstubAllGlobals());

describe("agent output command", () => {
  it("requests the complete available transcript without a line limit", () => {
    const command = agentOutputCommand({
      vmName: "factorize-vm",
      apiToken: "secret",
      agentKind: "codex",
      cwd: "/workspace",
    }, "factorize-1");

    expect(command).toContain("agent read 'factorize-1' --source recent --format text");
    expect(command).not.toContain("--lines");
  });
});

describe("terminal color environment", () => {
  const connection = { vmName: "factorize-vm", apiToken: "secret", agentKind: "codex", cwd: "/workspace" };

  it("enables ANSI/true-color output when launching an agent", () => {
    const command = launchAgentCommand("factorize-1", connection, "workspace", "/workspace/.factorize-runs/1", "lease", "prompt");
    expect(command).toContain("TERM=xterm-256color COLORTERM=truecolor FORCE_COLOR=1 CLICOLOR_FORCE=1");
  });

  it("keeps the color environment on agent restart paths", () => {
    expect(startAgentInPaneCommand("agent", connection, "pane")).toContain("TERM=xterm-256color COLORTERM=truecolor FORCE_COLOR=1 CLICOLOR_FORCE=1");
    expect(replaceForegroundCommand("agent", connection, "pane")).toContain("TERM=xterm-256color COLORTERM=truecolor FORCE_COLOR=1 CLICOLOR_FORCE=1");
  });
});

describe("agent stop command", () => {
  it("resolves the agent pane and closes it", () => {
    const command = stopAgentCommand({ vmName: "vm", apiToken: "secret", agentKind: "codex", cwd: "/workspace" }, "agent; unsafe");
    expect(command).toContain("agent get 'agent; unsafe'");
    expect(command).toContain("pane close \"$pane\"");
    expect(command).not.toContain("agent stop");
  });
});

describe("exe command exit status", () => {
  it("uses the command sentinel when the proxy omits X-Exe-Exit", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const marker = String(init.body).match(/__factorize_exit_[a-f0-9]+__/)?.[0];
      expect(marker).toBeTruthy();
      return new Response(`usage\n${marker}:2\n`, { status: 200 });
    }));

    const result = await exec({ vmName: "vm", apiToken: "secret", agentKind: "codex", cwd: "/workspace" }, "false");
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.body).toBe("usage");
  });
});

describe("connection model discovery", () => {
  it("uses the documented VM-local LLM endpoint", () => {
    expect(modelListCommand()).toContain("https://llm.int.exe.xyz/v1/models");
  });

  it("normalizes the returned model IDs", () => {
    expect(parseModelList('["gpt-5.5"," claude-sonnet-4-5","gpt-5.5",""]')).toEqual(["claude-sonnet-4-5", "gpt-5.5"]);
  });

  it("rejects malformed model responses", () => {
    expect(() => parseModelList('{"data":[]}')).toThrow("invalid response");
  });
});
