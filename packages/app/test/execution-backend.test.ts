import { afterEach, describe, expect, it, vi } from "vitest";
import { ExeVmBackend, isOwnedVmName, tagsFromInventory, vmNameFor } from "../src/exe-vm-backend";
import type { ExecutionBackend, ExecutionObservation, LaunchRequest, RunHandle } from "../src/execution";
import type { ExeRunConnection } from "../src/exe";
import { agentDriver } from "../src/agent-driver";

afterEach(() => vi.unstubAllGlobals());

const connection = { apiToken: "secret", agentKind: "codex", tags: ["github", "llm"], model: "gpt-5.5", effort: "high" } satisfies ExeRunConnection;

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

  it("does not mistake an authorized command error for a missing permission", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const command = String(init.body);
      if (command === "ssh --help") return new Response("VM name is required", { status: 422, headers: { "X-Exe-Exit": "1" } });
      if (command === "ls --json") return new Response('{"vms":[]}', { headers: { "X-Exe-Exit": "0" } });
      if (command === "integrations list --json") return new Response('{"integrations":[]}', { headers: { "X-Exe-Exit": "0" } });
      return new Response("help", { headers: { "X-Exe-Exit": "0" } });
    }));
    const result = await new ExeVmBackend({ apiToken: "secret", tags: [] }).testPermissions();
    expect(result.ok).toBe(true);
    expect(result.missingPermissions).toEqual([]);
  });

  it("creates a tagged VM and launches Codex directly in the workspace", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(String(init.body));
      return new Response(requests.length === 1 ? '{"name":"factorize-run-1"}' : "started", { headers: { "X-Exe-Exit": "0" } });
    }));
    const launched = await new ExeVmBackend(connection).launch({ runId: "run-1", prompt: "do the work", harness: agentDriver("codex").launch("run-1", {}) });
    expect(launched.handle).toEqual({ backendKind: "exe-vm", id: "factorize-run-1" });
    expect(requests[0]).toContain("new --name='factorize-run-1'");
    expect(requests[0]).toContain("--tag='github'");
    expect(requests[0]).toContain("--tag='llm'");
    expect(requests[1]).toContain("cd /home/exedev/workspace");
    expect(requests[1]).not.toContain("git clone");
    expect(requests[1]).toContain("codex");
    expect(requests[1]).toContain("--color");
    expect(requests[1]).toContain("never");
    expect(requests[1]).toContain("model_provider=exe-llm");
    expect(requests[1]).toContain("model_providers.exe-llm.base_url=\"https://llm.int.exe.xyz/v1\"");
    expect(requests[1]).toContain("sudo systemd-run");
    expect(requests[1]).toContain("--property=Type=exec");
    expect(requests[1]).toContain("--property=RemainAfterExit=yes");
    expect(requests[1]).toContain("--property=StandardInput=file:/tmp/factorize-prompt.md");
    expect(requests[1]).toContain("--property=StandardOutput=append:/tmp/factorize.log");
    expect(requests[1]).not.toContain("nohup");
    expect(requests[1]).toContain("; echo started");
    expect(requests[1]).toContain("systemctl show");
  });

  it("uses the systemd unit as the authoritative run state", async () => {
    const states = [
      "running",
      "succeeded",
      "failed",
      "missing",
    ];
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(String(init.body));
      return new Response(states.shift(), { headers: { "X-Exe-Exit": "0" } });
    }));
    const backend = new ExeVmBackend(connection), handle = { backendKind: "exe-vm", id: "factorize-run-1" };
    await expect(backend.inspect(handle)).resolves.toMatchObject({ state: "running" });
    await expect(backend.inspect(handle)).resolves.toMatchObject({ state: "succeeded" });
    await expect(backend.inspect(handle)).resolves.toMatchObject({ state: "failed", detail: expect.stringContaining("unsuccessfully") });
    await expect(backend.inspect(handle)).resolves.toMatchObject({ state: "failed", detail: expect.stringContaining("supervisor disappeared") });
    expect(requests.every(request => request.includes("systemctl show"))).toBe(true);
    expect(requests.every(request => !request.includes("factorize.status"))).toBe(true);
  });

  it("uploads an immutable snapshot of a session that may still be growing", async () => {
    let request = "";
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      request = String(init.body);
      return new Response("uploaded", { headers: { "X-Exe-Exit": "0" } });
    }));
    const result = await new ExeVmBackend(connection).collectArtifact(
      { backendKind: "exe-vm", id: "factorize-run-1" },
      { discoverCommand: "find sessions -name '*.jsonl' | head -1", contentType: "application/x-ndjson", uploadUrl: "https://app.example/upload" },
    );
    expect(result.ok).toBe(true);
    expect(request).toContain("snapshot=$(mktemp)");
    expect(request).toContain('cp "$file" "$snapshot"');
    expect(request).toContain('--data-binary @"$snapshot"');
  });

  it("uploads only the uncommitted byte range for a live trace", async () => {
    let request = "";
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { request = String(init.body); return new Response("uploaded", { headers: { "X-Exe-Exit": "0" } }); }));
    const result = await new ExeVmBackend(connection).collectTraceChunk(
      { backendKind: "exe-vm", id: "factorize-run-1" },
      { discoverCommand: "find sessions -name '*.jsonl' | head -1", generation: "1:2:3", offset: 1234, previousHash: "a".repeat(64), uploadUrl: "https://app.example/chunk" },
    );
    expect(result.ok).toBe(true);
    expect(request).toContain("start=1234");
    expect(request).toContain("iflag=skip_bytes,count_bytes");
    expect(request).toContain("X-Trace-Expected-Generation: 1:2:3");
    expect(request).toContain("X-Trace-Previous-Hash: $previous");
  });

  it("rejects an HTTP-successful launch whose shell did not acknowledge startup", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(String(init.body));
      if (requests.length === 1) return new Response("created", { headers: { "X-Exe-Exit": "0" } });
      if (requests.length <= 6) return new Response("bash: syntax error");
      if (String(init.body) === "ls --json") return new Response(JSON.stringify({ vms: [{ name: "factorize-run-1", comment: "Factorize VM factorize-run-1" }] }), { headers: { "X-Exe-Exit": "0" } });
      return new Response("removed", { headers: { "X-Exe-Exit": "0" } });
    }));
    const launched = await new ExeVmBackend(connection).launch({ runId: "run-1", prompt: "do the work", harness: agentDriver("codex").launch("run-1", {}) });
    expect(launched.observation.state).toBe("failed");
    expect(launched.observation.detail).toContain("bash: syntax error");
  });

  it("validates Codex and loads models in a temporary tagged VM that is deleted", async () => {
    const requests: string[] = [];
    let vm = "";
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const command = String(init.body); requests.push(command);
      if (command.startsWith("new ")) {
        vm = command.match(/--name='([^']+)'/)?.[1] ?? "";
        return new Response(JSON.stringify({ name: vm }), { headers: { "X-Exe-Exit": "0" } });
      }
      if (command.startsWith("ssh ")) return new Response('["gpt-5.5","gpt-5.6"]', { headers: { "X-Exe-Exit": "0" } });
      if (command === "ls --json") return new Response(JSON.stringify({ vms: [{ name: vm, comment: `Factorize VM ${vm}` }] }), { headers: { "X-Exe-Exit": "0" } });
      return new Response("removed", { headers: { "X-Exe-Exit": "0" } });
    }));
    const result = await new ExeVmBackend(connection).validateAgentAndModels("codex");
    expect(result.models).toEqual(["gpt-5.5", "gpt-5.6"]);
    expect(requests[0]).toContain("--tag='github'");
    expect(requests[1]).toContain("command -v codex");
    expect(requests[1]).toContain("https://llm.int.exe.xyz/v1/models");
    expect(requests.at(-1)).toBe(`rm '${vm}'`);
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
