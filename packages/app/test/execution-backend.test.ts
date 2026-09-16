import { afterEach, describe, expect, it, vi } from "vitest";
import { ExeHerdrBackend } from "../src/exe-herdr-backend";
import type { ExecutionBackend, ExecutionObservation, LaunchRequest, RunHandle } from "../src/execution";

afterEach(() => vi.unstubAllGlobals());

describe("ExeHerdrBackend", () => {
  it("returns independent launch and prompt delivery receipts", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = String(init.body), marker = body.match(/__factorize_exit_[a-f0-9]+__/)?.[0];
      requests.push(body);
      return new Response(`{\"result\":{\"agent\":{\"name\":\"run-1\",\"agent_status\":\"working\"}}}\n${marker}:0\n`);
    }));
    const backend = new ExeHerdrBackend({ vmName: "vm", apiToken: "secret", agentKind: "codex", cwd: "/repo" }, { agentName: "run-1", workspaceName: "flow", runPath: "/repo/.factorize-runs/run-1", lease: "lease" });
    const launched = await backend.launch({ runId: "run-1", prompt: "do the work" });
    expect(launched.handle).toEqual({ backendKind: "exe-herdr", id: "run-1" });
    expect(launched.capabilities).toEqual(["output", "prompt-delivery", "recovery"]);
    expect(launched.destinationUrl).toBe("https://exe.dev/");
    expect(requests[0]).toContain("agent start");
    expect(requests[0]).toContain("ZG8gdGhlIHdvcms=");
    expect(requests[0]).toContain("Read and follow the complete task instructions in /tmp/factorize-prompts/run-1/prompt.md");
    expect(requests[0]).not.toContain("agent prompt 'run-1' 'do the work'");
    const delivered = await backend.deliverPrompt(launched.handle, "do the work");
    expect(delivered.state).toBe("accepted");
    expect(requests[1]).toContain("agent prompt");
    expect(requests[1]).not.toContain("agent start");
  });
});

describe("ExecutionBackend contract", () => {
  it("launches, observes, and stops a fake without trigger or provider details", async () => {
    class FakeBackend implements ExecutionBackend {
      readonly kind = "fake";
      readonly capabilities = [] as const;
      state: ExecutionObservation["state"] = "queued";
      async launch(request: LaunchRequest) { this.state = "running"; return { handle: { backendKind: this.kind, id: request.runId }, destinationUrl: `https://runs.example/${request.runId}`, capabilities: this.capabilities, observation: { state: this.state } }; }
      async inspect(_handle: RunHandle) { return { state: this.state }; }
      async stop(_handle: RunHandle) { this.state = "stopped"; return { state: this.state }; }
    }
    const backend = new FakeBackend();
    const launched = await backend.launch({ runId: "1", prompt: "work" });
    expect(await backend.inspect(launched.handle)).toEqual({ state: "running" });
    expect(await backend.stop(launched.handle)).toEqual({ state: "stopped" });
    expect((backend as ExecutionBackend).readOutput).toBeUndefined();
  });
});
