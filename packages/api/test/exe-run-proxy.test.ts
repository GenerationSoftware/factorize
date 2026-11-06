import { afterEach, describe, expect, it, vi } from "vitest";
import { ExeRunProxy } from "../src/exe-run-proxy";
import { ExeVmBackend, vmNameFor } from "../src/exe-vm-backend";
import { agentDriver } from "../src/agent-driver";
import { runProxyName } from "../src/run-credentials";
import type { BackendCommandResult } from "../src/execution";

afterEach(() => vi.unstubAllGlobals());
const runId = "00000000-0000-4000-8000-000000000001", vm = vmNameFor(runId), name = runProxyName(runId);
const target = "https://app.factorize.test";
const until = new Date(Date.now() + 23 * 60 * 60_000).toISOString();
const owned = { name, type: "http-proxy", target, attachments: [`vm:${vm}@${until}`], comment: `Factorize run ${runId}`, help: `curl https://${name}.int.exe.xyz/` };
const context = { kind: "factorize-runtime-context-v1", authMethod: "run_token", runId, jobId: "source-job", scopes: ["runs:read", "runs:invoke"] };
const result = (body: unknown = [], ok = true): BackendCommandResult => ({ ok, body: typeof body === "string" ? body : JSON.stringify(body), status: ok ? 200 : 503, exitCode: ok ? 0 : 1, requestBody: "not retained" });

describe("exe.dev run proxy lifecycle", () => {
  it("installs the credential in the control plane and time-boxes a VM-specific attachment", async () => {
    const commands: string[] = [];
    const proxy = new ExeRunProxy(async command => { commands.push(command); return result(); });
    await proxy.provision(await proxy.prepare(runId), vm, "https://app.factorize.test", "private-run-token");
    expect(commands).toHaveLength(3);
    expect(commands[1]).toContain("integrations add http-proxy");
    expect(commands[1]).toContain("--bearer='private-run-token'");
    expect(commands[1]).toContain(`--comment='Factorize run ${runId}'`);
    expect(commands[2]).toBe(`integrations attach '${name}' 'vm:${vm}' --for=24h`);
    expect(commands.some(command => command.startsWith("ssh "))).toBe(false);
  });

  it("rotates an owned integration on retry and removes it idempotently", async () => {
    let installed = true;
    const commands: string[] = [];
    const proxy = new ExeRunProxy(async command => {
      commands.push(command);
      if (command === "integrations list --json") return result(installed ? [owned] : []);
      if (command.startsWith("integrations remove")) installed = false;
      if (command.startsWith("integrations add")) installed = true;
      return result();
    });
    await proxy.provision(await proxy.prepare(runId), vm, "https://app.factorize.test", "replacement-token");
    expect(commands.slice(1, 3)).toEqual(["integrations list --json", `integrations remove '${name}'`]);
    expect(commands[3]).toContain("integrations add http-proxy");
    expect(commands[3]).toContain("--bearer='replacement-token'");
    expect(commands.some(command => command.startsWith("integrations edit"))).toBe(false);
    await proxy.remove(name, runId);
    await proxy.remove(name, runId);
    expect(commands.filter(command => command.startsWith("integrations remove"))).toHaveLength(2);
  });

  it("refuses to replace or remove a colliding integration without its ownership marker", async () => {
    const commands: string[] = [];
    const proxy = new ExeRunProxy(async command => { commands.push(command); return result([{ ...owned, comment: "unrelated" }]); });
    await expect(proxy.prepare(runId)).rejects.toThrow("another integration");
    await expect(proxy.remove(name, runId)).rejects.toThrow("ownership marker");
    await expect(proxy.remove("production", runId)).rejects.toThrow("unrelated");
    expect(commands.every(command => command === "integrations list --json")).toBe(true);
  });

  it("rechecks ownership before replacing an existing proxy on retry", async () => {
    const commands: string[] = [];
    const proxy = new ExeRunProxy(async command => {
      commands.push(command);
      return result([{ ...owned, comment: commands.length === 1 ? owned.comment : "unrelated" }]);
    });
    const plan = await proxy.prepare(runId);
    await expect(proxy.provision(plan, vm, target, "replacement-token")).rejects.toThrow("ownership marker");
    expect(commands).toEqual(["integrations list --json", "integrations list --json"]);
  });

  it("does not install a replacement credential when removal fails", async () => {
    const commands: string[] = [];
    const proxy = new ExeRunProxy(async command => {
      commands.push(command);
      return command === "integrations list --json" ? result([owned]) : result("unavailable", false);
    });
    await expect(proxy.provision(await proxy.prepare(runId), vm, target, "replacement-token")).rejects.toThrow("cleanup failed");
    expect(commands).toEqual(["integrations list --json", "integrations list --json", `integrations remove '${name}'`]);
  });

  it.each([false, true])("never exposes a credential echoed by provisioning failure (throws=%s)", async throws => {
    const secret = "private-run-token";
    const proxy = new ExeRunProxy(async command => {
      if (command === "integrations list --json") return result();
      if (throws) throw new Error(`provider echoed ${secret}`);
      return result(`provider echoed ${secret}`, false);
    });
    const plan = await proxy.prepare(runId);
    try { await proxy.provision(plan, vm, "https://app.factorize.test", secret); throw new Error("Unexpected provision success"); }
    catch (error) { expect(String(error)).not.toContain(secret); expect(String(error)).toContain("Run proxy provisioning"); }
  });

  it.each(["auto:all", `vm:${vm}`, "tag:factorize", `tag:factorize@${until}`])("blocks shared attachment %s independently of the guest", async spec => {
    const other = { name: "shared-factorize", type: "http-proxy", target, attachments: [spec] };
    const commands: string[] = [];
    const proxy = new ExeRunProxy(async command => {
      commands.push(command);
      if (command === "integrations list --json") return result([owned, other]);
      // A guest claiming it only sees its own proxy cannot hide the grant.
      if (command.includes("reflection.int.exe.xyz")) return result({ integrations: [owned] });
      return result(context);
    });
    await expect(proxy.verify(vm, runId, target, ["factorize"])).rejects.toThrow("Unsafe shared Factorize integration shared-factorize");
    expect(commands).toEqual(["integrations list --json"]);
  });

  it("allows operator-only integrations without exposing them to the guest", async () => {
    const other = { name: "factorize", type: "http-proxy", target, attachments: ["tag:human"] };
    const proxy = new ExeRunProxy(async command => command === "integrations list --json" ? result([owned, other])
      : command.includes("reflection.int.exe.xyz") ? result({ integrations: [owned] }) : result(context));
    await expect(proxy.verify(vm, runId, target, ["factorize"])).resolves.toBeUndefined();
  });

  it.each([{ scopes: [] }, { scopes: ["jobs:write"] }])("verifies a dedicated proxy without requiring read or invoke scopes ($scopes)", async ({ scopes }) => {
    const proxy = new ExeRunProxy(async command => command === "integrations list --json" ? result([owned])
      : command.includes("reflection.int.exe.xyz") ? result({ integrations: [owned] }) : result({ ...context, scopes }));
    await expect(proxy.verify(vm, runId, target)).resolves.toBeUndefined();
  });

  it("rejects a run proxy with attachments to other VMs", async () => {
    const proxy = new ExeRunProxy(async () => result([{ ...owned, attachments: [`vm:${vm}`, "auto:all"] }]));
    await expect(proxy.verify(vm, runId, target)).rejects.toThrow("attached only to its execution VM");
  });

  it.each([`vm:${vm}`, `vm:${vm}@2000-01-01T00:00:00Z`, `vm:${vm}@${new Date(Date.now() + 48 * 60 * 60_000).toISOString()}`])("rejects an unbounded, expired, or excessive proxy lease: %s", async grant => {
    const proxy = new ExeRunProxy(async () => result([{ ...owned, attachments: [grant] }]));
    await expect(proxy.verify(vm, runId, target)).rejects.toThrow("at most 24 hours");
  });

  it("rejects shared authority before even creating the execution VM", async () => {
    const commands: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      commands.push(String(init.body));
      return Response.json([{ name: "factorize", type: "http-proxy", target, attachments: ["auto:all"] }]);
    }));
    const launched = await new ExeVmBackend({ apiToken: "control-plane-token", agentKind: "codex", tags: [] }).launch({ runId, prompt: "work", harness: agentDriver("codex").launch(runId, {}), runProxy: { targetOrigin: target, credential: "private-run-token" } });
    expect(launched.observation.state).toBe("failed");
    expect(launched.observation.detail).toContain("Unsafe shared Factorize integration");
    expect(commands).toEqual(["integrations list --json", "integrations list --json"]);
  });

  it("fails closed when a Factorize proxy's authority cannot be inspected", async () => {
    const proxy = new ExeRunProxy(async command => command === "integrations list --json" ? result([owned])
      : command.includes("reflection.int.exe.xyz") ? result({ integrations: [owned] }) : result({ error: { code: "internal_error" } }));
    await expect(proxy.verify(vm, runId, target)).rejects.toThrow("identity could not be verified");
  });

  it("rejects a run proxy that authenticates as a different run", async () => {
    const proxy = new ExeRunProxy(async command => command === "integrations list --json" ? result([owned]) : command.includes("reflection.int.exe.xyz") ? result({ integrations: [owned] }) : result({ ...context, runId: "another-run" }));
    await expect(proxy.verify(vm, runId, target)).rejects.toThrow("run proxy identity could not be verified");
  });

  it("retains cleanup on proxy deletion failure rather than claiming success", async () => {
    const proxy = new ExeRunProxy(async command => command === "integrations list --json" ? result([owned]) : result("unavailable", false));
    await expect(proxy.remove(name, runId)).rejects.toThrow("cleanup failed");
  });

  it("launches without placing the credential in guest commands, prompts, or receipts", async () => {
    const commands: string[] = [];
    const secret = "private-run-token";
    let installed = false;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const command = String(init.body); commands.push(command);
      if (command === "integrations list --json") return Response.json(installed ? [owned] : []);
      if (command.startsWith("integrations add")) installed = true;
      if (command.includes("reflection.int.exe.xyz")) return Response.json({ integrations: [owned] });
      if (command.includes("/api/v1/runtime-context")) return Response.json(context);
      return new Response(command.startsWith("ssh ") ? "started" : "{}", { headers: { "X-Exe-Exit": "0" } });
    }));
    const launched = await new ExeVmBackend({ apiToken: "control-plane-token", agentKind: "codex", tags: [] }).launch({
      runId, prompt: "work", harness: agentDriver("codex").launch(runId, {}), runProxy: { targetOrigin: "https://app.factorize.test", credential: secret },
    });
    expect(launched.observation.state).toBe("running");
    expect(launched.handle.runProxyName).toBe(name);
    expect(commands.filter(command => command.includes(secret))).toHaveLength(1);
    expect(commands.filter(command => command.startsWith("ssh ")).join("\n")).not.toContain(secret);
    expect(commands.filter(command => command.startsWith("ssh ")).join("\n")).not.toContain("https://app.factorize.test");
    expect(JSON.stringify(launched)).not.toContain(secret);
  });

  it("does not start the agent after a partial provision and retries proxy cleanup", async () => {
    const commands: string[] = [];
    let installed = false, removalFails = true;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const command = String(init.body); commands.push(command);
      if (command === "integrations list --json") return Response.json(installed ? [owned] : []);
      if (command.startsWith("integrations add")) { installed = true; throw new Error("provider echoed private-run-token"); }
      if (command.startsWith("integrations remove")) {
        if (removalFails) return new Response("unavailable", { status: 503 });
        installed = false;
      }
      if (command === "ls --json") return Response.json({ vms: [{ name: vm, comment: `Factorize VM ${vm}` }] });
      return new Response("{}", { headers: { "X-Exe-Exit": "0" } });
    }));
    const backend = new ExeVmBackend({ apiToken: "control-plane-token", agentKind: "codex", tags: [] });
    const launched = await backend.launch({ runId, prompt: "work", harness: agentDriver("codex").launch(runId, {}), runProxy: { targetOrigin: target, credential: "private-run-token" } });
    expect(launched.observation.state).toBe("failed");
    expect(launched.handle.runProxyName).toBe(name);
    expect(commands.some(command => command.includes("systemd-run"))).toBe(false);
    expect(JSON.stringify(launched)).not.toContain("private-run-token");
    expect((await backend.stop(launched.handle)).state).toBe("failed");
    expect(commands).toContain(`rm '${vm}'`);
    removalFails = false;
    expect((await backend.stop(launched.handle)).state).toBe("stopped");
    expect(commands.filter(command => command.startsWith("integrations remove"))).toHaveLength(2);
  });
});
