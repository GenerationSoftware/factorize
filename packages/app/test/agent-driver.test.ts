import { describe, expect, it } from "vitest";
import { agentDriver } from "../src/agent-driver";

describe("agent drivers", () => {
  it("gives Claude and Pi deterministic session identities", () => {
    expect(agentDriver("claude").launch("00000000-0000-4000-8000-000000000001", {}).args).toContain("00000000-0000-4000-8000-000000000001");
    const pi = agentDriver("pi").launch("run-1", {});
    expect(pi.args).toEqual(expect.arrayContaining(["--session-id", "run-1", "--session-dir", "/tmp/factorize-artifacts/run-1/pi"]));
  });
  it("keeps transport details out of every driver", () => {
    for (const kind of ["codex", "claude", "pi"] as const) expect(JSON.stringify(agentDriver(kind).launch("run-1", {}))).not.toContain("ssh");
  });
});
