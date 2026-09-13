import { describe, expect, it } from "vitest";
import { agentOutputCommand, stopAgentCommand } from "../src/exe";

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

describe("agent stop command", () => {
  it("uses the fixed Herdr agent stop command and quotes the agent name", () => {
    const command = stopAgentCommand({ vmName: "vm", apiToken: "secret", agentKind: "codex", cwd: "/workspace" }, "agent; unsafe");
    expect(command).toContain("agent stop 'agent; unsafe'");
  });
});
