import { describe, expect, it } from "vitest";
import { agentOutputCommand } from "../src/exe";

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
