import { afterEach, describe, expect, it, vi } from "vitest";
import { ExeHerdrBackend } from "../src/exe-herdr-backend";

afterEach(() => vi.unstubAllGlobals());

describe("ExeHerdrBackend", () => {
  it("returns independent launch and prompt delivery receipts", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = String(init.body), marker = body.match(/__factorize_exit_[a-f0-9]+__/)?.[0];
      requests.push(body);
      return new Response(`{\"result\":{\"agent\":{\"name\":\"run-1\",\"agent_status\":\"working\"}}}\n${marker}:0\n`);
    }));
    const backend = new ExeHerdrBackend({ vmName: "vm", apiToken: "secret", agentKind: "codex", cwd: "/repo" });
    const launched = await backend.launch({ runId: "run-1", agentName: "run-1", workspaceName: "flow", runPath: "/repo/.factorize-runs/run-1", lease: "lease", prompt: "do the work" });
    expect(requests[0]).toContain("agent start");
    expect(requests[0]).toContain("ZG8gdGhlIHdvcms=");
    expect(requests[0]).toContain("Read and follow the complete task instructions in /tmp/factorize-prompts/run-1/prompt.md");
    expect(requests[0]).not.toContain("agent prompt");
    const delivered = await backend.deliverPrompt(launched.handle, "do the work");
    expect(delivered.state).toBe("accepted");
    expect(requests[1]).toContain("agent prompt");
    expect(requests[1]).not.toContain("agent start");
  });
});
