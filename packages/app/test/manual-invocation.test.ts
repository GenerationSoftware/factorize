import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiService } from "../src/flow-service";
import { protectedApiFetch } from "../src/protected-api";
import { decrypt } from "../src/crypto";
import type { Invocation, Job, JobRun } from "../src/job-domain";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));

afterEach(() => vi.restoreAllMocks());

describe("manual invocation API and shared service", () => {
  const name = "GEN-2106 — Issue title";
  async function invoke(input: Record<string, unknown>, template = "{{trigger-1.data.identifier}} — {{trigger-1.data.title}}", transport = "REST") {
    const job: Job = {
      id: "job-1", name: "dev", slug: "dev", promptTemplate: "{{trigger-1.prompt}} {{trigger-1.data.identifier}}",
      runNameTemplate: template, model: "", executionTarget: { connectionId: "exe-1", workspace: "", cwd: "", agentKind: "codex" },
      concurrencyLimit: 1, enabled: true, createdAt: "now", updatedAt: "now",
      triggers: [{ id: "manual-1", jobId: "job-1", kind: "manual", slug: "trigger-1", enabled: true, config: {}, createdAt: "now", updatedAt: "now" }],
    };
    let persisted: { invocation: Invocation; run: JobRun } | undefined;
    const repository = {
      getJob: async () => job,
      findInvocation: async () => persisted ?? null,
      insertInvocationAndRun: async (invocation: Invocation, run: JobRun) => { persisted = structuredClone({ invocation, run }); return true; },
    };
    vi.spyOn(ApiService.prototype as any, "authorize").mockResolvedValue(undefined);
    vi.spyOn(ApiService.prototype as any, "jobs").mockReturnValue(repository);
    const key = btoa("a".repeat(32));
    const env = { CREDENTIAL_ENCRYPTION_KEY: key, APP_ORIGIN: "https://example.com" } as any;
    const request = async (body: Record<string, unknown>) => {
      const response = await protectedApiFetch(new Request("https://example.com" + (transport === "REST" ? "/api/v1/jobs/job-1/invocations" : "/mcp"), {
        method: "POST", headers: { Host: "example.com", "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify(transport === "REST" ? body : { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "invoke_job", arguments: { jobId: "job-1", ...body } } }),
      }), env, {} as any, {} as any);
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
    expect(await decrypt(persisted!.run.encryptedPrompt, key)).toBe("Fix GEN-2106");
    expect(persisted!.invocation.context).toEqual({ "trigger-1": { prompt: "Fix", data: { identifier: "GEN-2106", title: "Issue title" } } });
    return { persisted: persisted!, request, result };
  }

  it.each(["REST", "MCP"])("persists the %s name instead of the template and retains it on replay", async transport => {
    const { persisted, request, result } = await invoke({ name: "  " + name + "  " }, "Template name", transport);
    expect(persisted.run.runName).toBe(name);
    const retry = await request({ name: "Replacement", idempotencyKey: "issue-1", data: { identifier: "changed" } });
    expect(await retry.json()).toEqual({ ...result, duplicate: true });
    expect(persisted.run.runName).toBe(name);
  });

  it("renders the name from normalized manual trigger data", async () => {
    expect((await invoke({})).persisted.run.runName).toBe(name);
  });

  it.each(["", "{{trigger-1.data.missing}}", "{{#invalid}}"])("falls back to the Job name for template %j", async template => {
    expect((await invoke({}, template)).persisted.run.runName).toBe("dev");
  });
});
