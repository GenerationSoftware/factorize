import { afterEach, describe, expect, it, vi } from "vitest";
import { ExeVmBackend, isOwnedVmName, tagsFromInventory, vmNameFor } from "../src/exe-vm-backend";
import type { ExecutionBackend, ExecutionObservation, LaunchRequest, RunHandle } from "../src/execution";

afterEach(() => vi.unstubAllGlobals());

const connection = { apiToken: "secret", agentKind: "codex", repositoryUrl: "https://github.int.exe.xyz/acme/repo.git", checkoutRef: "main", tags: ["github", "llm"], model: "gpt-5.5", effort: "high" };

describe("ExeVmBackend", () => {
  it("tests every required permission and discovers sorted unique VM tags", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => String(init.body) === "ssh --help"
      ? new Response("forbidden", { status: 403 })
      : new Response(String(init.body) === "ls --json" ? '{"vms":[{"tags":["github","llm"]},{"tags":["github"]}]}' : "help", { headers: { "X-Exe-Exit": "0" } })));
    const result = await new ExeVmBackend({ apiToken: "secret", tags: [] }).testPermissions();
    expect(result.ok).toBe(false);
    expect(result.missingPermissions).toEqual(["ssh"]);
    expect(result.tags).toEqual(["github", "llm"]);
    expect(result.checks.map(check => check.requestBody)).toEqual(["ls --json", "integrations list --json", "new --help", "ssh --help", "rm --help"]);
  });

  it("extracts tags only from tag arrays", () => {
    expect(tagsFromInventory({ tags: ["one"], nested: { name: "ignored", attachments: ["tag:three"], tags: ["two", "one"] } })).toEqual(["one", "three", "two"]);
  });

  it("creates a tagged VM, clones the repository, and launches Codex directly", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(String(init.body));
      return new Response(requests.length === 1 ? '{"name":"factorize-run-1"}' : "started", { headers: { "X-Exe-Exit": "0" } });
    }));
    const launched = await new ExeVmBackend(connection).launch({ runId: "run-1", prompt: "do the work" });
    expect(launched.handle).toEqual({ backendKind: "exe-vm", id: "factorize-run-1" });
    expect(requests[0]).toContain("new --name='factorize-run-1'");
    expect(requests[0]).toContain("--tag='github'");
    expect(requests[0]).toContain("--tag='llm'");
    expect(requests[1]).toContain("git clone --");
    expect(requests[1]).toContain("codex");
  });

  it("refuses to delete a VM outside the owned namespace", async () => {
    await expect(new ExeVmBackend(connection).stop({ backendKind: "exe-vm", id: "production" })).rejects.toThrow("Invalid exe-vm execution handle");
    expect(isOwnedVmName("factorize-run-1")).toBe(true);
    expect(isOwnedVmName("production")).toBe(false);
  });

  it("reports deletion failure after bounded retries", async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => String(init.body) === "ls --json"
      ? new Response('{"vms":[{"name":"factorize-run-1","comment":"Factorize VM factorize-run-1"}]}', { headers: { "X-Exe-Exit": "0" } })
      : new Response("busy", { status: 422 }));
    vi.stubGlobal("fetch", fetch);
    const stopped = await new ExeVmBackend(connection).stop({ backendKind: "exe-vm", id: vmNameFor("run-1") });
    expect(stopped.state).toBe("failed");
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("will not delete a prefixed VM without the exact ownership marker", async () => {
    const fetch = vi.fn(async () => new Response('{"vms":[{"name":"factorize-run-1","comment":"created by somebody else"}]}', { headers: { "X-Exe-Exit": "0" } }));
    vi.stubGlobal("fetch", fetch);
    const stopped = await new ExeVmBackend(connection).stop({ backendKind: "exe-vm", id: "factorize-run-1" });
    expect(stopped.state).toBe("failed");
    expect(stopped.detail).toContain("ownership marker");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("ExecutionBackend contract", () => {
  it("launches, observes, and stops a provider-neutral backend", async () => {
    class FakeBackend implements ExecutionBackend {
      readonly kind = "fake"; readonly capabilities = [] as const; state: ExecutionObservation["state"] = "queued";
      async launch(request: LaunchRequest) { this.state = "running"; return { handle: { backendKind: this.kind, id: request.runId }, destinationUrl: `https://runs.example/${request.runId}`, capabilities: this.capabilities, observation: { state: this.state } }; }
      async inspect(_handle: RunHandle) { return { state: this.state }; }
      async stop(_handle: RunHandle) { this.state = "stopped"; return { state: this.state }; }
    }
    const backend = new FakeBackend(), launched = await backend.launch({ runId: "1", prompt: "work" });
    expect(await backend.inspect(launched.handle)).toEqual({ state: "running" });
    expect(await backend.stop(launched.handle)).toEqual({ state: "stopped" });
  });
});
