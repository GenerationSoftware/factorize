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
  it("passes only selected listener endpoints to provider clients", () => {
    const xId = "00000000-0000-4000-8000-000000000099";
    const launch = agentDriver("codex").launch("run-1", { providerEndpoints: { githubInstallationIds: [42, 43, 42], linear: true, model: true, xConnectionIds: [xId, xId] } });
    expect(JSON.parse(launch.env.FACTORIZE_GITHUB_INSTALLATIONS!)).toEqual([
      { installationId: 42, apiUrl: "http://127.0.0.1:18180/providers/github/42/", gitUrl: "http://127.0.0.1:18180/providers/github/42/" },
      { installationId: 43, apiUrl: "http://127.0.0.1:18180/providers/github/43/", gitUrl: "http://127.0.0.1:18180/providers/github/43/" },
    ]);
    expect(launch.env.FACTORIZE_LINEAR_API_URL).toBe("http://127.0.0.1:18180/providers/linear/");
    expect(launch.env.FACTORIZE_MODEL_API_URL).toBe("http://127.0.0.1:18180/providers/model/v1");
    expect(JSON.parse(launch.env.FACTORIZE_X_CONNECTIONS!)).toEqual([{ id: xId, apiUrl: `http://127.0.0.1:18180/x/${xId}/` }]);
    expect(JSON.stringify(launch.env)).not.toMatch(/token|secret|credential/i);
  });
});
