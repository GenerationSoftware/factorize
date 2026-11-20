import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiService } from "../src/flow-service";
import { protectedApiFetch } from "../src/protected-api";
import { decrypt } from "../src/crypto";
import type { Invocation, Trigger, TriggerRun } from "../src/job-domain";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));

afterEach(() => vi.restoreAllMocks());

describe("manual invocation API and shared service", () => {
  const name = "GEN-2106 — Issue title";
  async function invoke(input: Record<string, unknown>, template = "{{event-1.data.identifier}} — {{event-1.data.title}}", transport = "REST", sourceAuth?: { runId: string; runTriggerId: string; allowed: boolean }) {
    const trigger: Trigger = {
      id: "trigger-1", name: "dev", slug: "dev", prompt: "",
      runNameTemplate: template, model: "", executionConfig: { connectionId: "exe-1", workspace: "", cwd: "", agentKind: "codex" },
      concurrencyLimit: 1, enabled: true, createdAt: "now", updatedAt: "now",
      events: [{ id: "manual-1", triggerId: "trigger-1", kind: "manual", slug: "event-1", enabled: true, template: "Issue {{data.identifier}}", config: {}, createdAt: "now", updatedAt: "now" }],
    };
    let persisted: { invocation: Invocation; run: TriggerRun } | undefined;
    const repository = {
      getTrigger: async () => trigger,
      findInvocation: async () => persisted ?? null,
      insertInvocationAndRun: async (invocation: Invocation, run: TriggerRun) => { persisted = structuredClone({ invocation, run }); return true; },
    };
    vi.spyOn(ApiService.prototype as any, "authorize").mockResolvedValue(undefined);
    vi.spyOn(ApiService.prototype as any, "triggers").mockReturnValue(repository);
    const key = btoa("a".repeat(32));
    const env = { CREDENTIAL_ENCRYPTION_KEY: key, APP_ORIGIN: "https://example.com", DATABASE: { pool: { query: async () => ({ rows: sourceAuth?.allowed ? [{ ok: 1 }] : [], rowCount: sourceAuth?.allowed ? 1 : 0 }) } } } as any;
    const request = async (body: Record<string, unknown>) => {
      const response = await protectedApiFetch(new Request("https://example.com" + (transport === "REST" ? "/api/v1/triggers/trigger-1/invocations" : "/mcp"), {
        method: "POST", headers: { Origin: env.APP_ORIGIN, Host: "example.com", "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify(transport === "REST" ? body : { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "invoke_trigger", arguments: { triggerId: "trigger-1", ...body } } }),
      }), env, sourceAuth ? { scopes: ["runs:invoke"], authMethod: "vendor_identity", runId: sourceAuth.runId, runTriggerId: sourceAuth.runTriggerId } as any : { scopes: ["runs:read", "runs:invoke", "runs:cancel", "runs:write"], authMethod: "session" } as any, {} as any);
      if (transport === "REST") return response;
      expect(response.status).toBe(200);
      const text = await response.text();
      const message = JSON.parse(text.startsWith("event:") ? text.split("\n").find(line => line.startsWith("data:"))!.slice(5) : text);
      expect(message.error).toBeUndefined();
      expect(message.result.isError).not.toBe(true);
      return Response.json(message.result.structuredContent, { status: 202 });
    };
    const response = await request({ prompt: "Fix", data: { identifier: "GEN-2106", title: "Issue title" }, idempotencyKey: "issue-1", ...input });
    expect(response.status).toBe(202);
    const result = await response.json() as any;
    expect(result.runId).toBe(persisted?.run.id);
    expect(await decrypt(persisted!.run.encryptedPrompt, key)).toBe("Issue GEN-2106\n\nFix");
    expect(persisted!.invocation.context).toEqual({ "event-1": { prompt: "Fix", data: { identifier: "GEN-2106", title: "Issue title" } } });
    return { persisted: persisted!, request, result };
  }

  it.each(["REST", "MCP"])("persists the %s name instead of the template and retains it on replay", async transport => {
    const { persisted, request, result } = await invoke({ name: "  " + name + "  " }, "Template name", transport);
    expect(persisted.run.runName).toBe(name);
    const retry = await request({ name: "Replacement", idempotencyKey: "issue-1", data: { identifier: "changed" } });
    expect(await retry.json()).toEqual({ ...result, duplicate: true });
    expect(persisted.run.runName).toBe(name);
  });

  it("renders the name from normalized manual event data", async () => {
    expect((await invoke({})).persisted.run.runName).toBe(name);
  });

  it.each(["REST", "MCP"]) ("derives trigger/run provenance and enforces permission through %s", async transport => {
    const identity = { runId: "run-source", runTriggerId: "trigger-source", allowed: true };
    const accepted = await invoke({ idempotencyKey: "retry-1" }, undefined, transport, identity);
    expect(accepted.persisted.invocation).toMatchObject({ sourceTriggerId: "trigger-source", sourceRunId: "run-source" });
    expect(await (await accepted.request({ idempotencyKey: "retry-1" })).json()).toEqual({ ...accepted.result, duplicate: true });
    await expect(invoke({}, undefined, transport, { ...identity, allowed: false })).rejects.toThrow();
    await expect(invoke({ sourceTriggerId: "forged", sourceRunId: "other-run" }, undefined, transport, identity)).rejects.toThrow();
  });

  it("allows an active run to invoke its own trigger only while its self-permission exists", async () => {
    const self = { runId: "run-self", runTriggerId: "trigger-1", allowed: true };
    const accepted = await invoke({ idempotencyKey: "successor-1" }, undefined, "REST", self);
    expect(accepted.persisted.invocation).toMatchObject({ triggerId: "trigger-1", sourceTriggerId: "trigger-1", sourceRunId: "run-self" });
    await expect(invoke({}, undefined, "REST", { ...self, allowed: false })).rejects.toThrow();
  });

  it.each(["", "{{event-1.data.missing}}", "{{#invalid}}"])("falls back to the Trigger name for template %j", async template => {
    expect((await invoke({}, template)).persisted.run.runName).toBe("dev");
  });
});
