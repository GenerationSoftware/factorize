import { afterEach, describe, expect, it, vi } from "vitest";
import { protectedApiFetch } from "../src/protected-api";
import { ApiService } from "../src/flow-service";
import { InvocationService } from "../src/job-domain";
import { evaluateWebhookConditions } from "../src/webhook-conditions";
import { matchApiOperation } from "../src/api-contract";
vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));
afterEach(() => vi.restoreAllMocks());
const condition = { fact: "webhook", path: "$.provider", operator: "equal", value: "github" };
function fixture(scopes = ["flows:write"], member = true) {
  const query = vi.fn().mockResolvedValue({ rows: member ? [{ user_id: "owner", role: "owner", session_version: 1 }] : [] });
  const env = { APP_ORIGIN: "https://example.com", DATABASE: { pool: { query } } } as any;
  const auth = { tenantId: "tenant", userId: "owner", sessionVersion: 1, authMethod: "bearer", scopes } as any;
  async function send(transport: string, input: unknown, tool = "test_job_webhook_conditions") {
    return protectedApiFetch(new Request(env.APP_ORIGIN + (transport === "MCP" ? "/mcp" : "/api/v1/job-conditions/test"), { method: "POST", headers: { Origin: env.APP_ORIGIN, Host: "example.com", "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify(transport === "MCP" ? { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: input } } : input) }), env, auth, {} as any);
  }
  return { send, query, env, auth };
}
async function message(response: Response) {
  const text = await response.text();
  return JSON.parse(text.startsWith("event:") ? text.split("\n").find(line => line.startsWith("data:"))!.slice(5) : text);
}
describe("conditions REST/MCP boundaries", () => {
  it.each(["REST", "MCP"])("%s uses the evaluator, authorizes, and never invokes or verifies GitHub", async transport => {
    const f = fixture(), invoke = vi.spyOn(InvocationService.prototype, "invoke"), fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network allowed"));
    for (const webhook of [{ provider: "github" }, { provider: "linear" }]) {
      const response = await f.send(transport, { conditions: condition, webhook }); expect(response.status).toBe(200);
      const body = await message(response), output = transport === "MCP" ? body.result.structuredContent : body;
      expect(output).toEqual(await evaluateWebhookConditions(condition, webhook));
    }
    expect(f.query).toHaveBeenCalledTimes(2); expect(invoke).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["REST", "MCP"])("%s rejects insufficient scopes and revoked/removed owners", async transport => {
    for (const f of [fixture(["flows:read"]), fixture(["flows:write"], false)]) {
      const response = await f.send(transport, { conditions: condition, webhook: {} });
      if (transport === "REST") expect([401, 403]).toContain(response.status);
      else { const body = await message(response); expect(body.result?.isError || body.error).toBeTruthy(); }
    }
  });
  it.each(["REST", "MCP"])("%s rejects invalid shape, oversized examples and legacy fields", async transport => {
    for (const input of [{ conditions: { all: [] }, webhook: {} }, { conditions: condition, webhook: [] }, { conditions: condition, webhook: { value: "x".repeat(262145) } }, { handlerCode: "removed", payload: {} }]) {
      const response = await fixture().send(transport, input);
      if (transport === "REST") expect(response.status).toBe(400);
      else { const body = await message(response); expect(body.result?.isError || body.error).toBeTruthy(); }
    }
  });
  it("removes legacy endpoint/tool and bounds the raw HTTP request", async () => {
    expect(matchApiOperation("POST", "/api/v1/job-handlers/test")).toBeUndefined();
    const body = await message(await fixture().send("MCP", {}, "test_job_webhook_handler")); expect(body.error || body.result?.isError).toBeTruthy();
    const f = fixture();
    const response = await protectedApiFetch(new Request(f.env.APP_ORIGIN + "/api/v1/job-conditions/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: " ".repeat(300001) + "{}" }), f.env, f.auth, {} as any);
    expect(response.status).toBe(400); expect(f.query).not.toHaveBeenCalled();
    const anonymous = await protectedApiFetch(new Request(f.env.APP_ORIGIN + "/api/v1/job-conditions/test", { method: "POST" }), f.env, null, {} as any); expect(anonymous.status).toBe(401);
  });
  it("service validates even when called directly", async () => {
    const f = fixture(); await expect(new ApiService(f.env, f.auth).testJobConditions({ conditions: { all: [] }, webhook: {} })).rejects.toThrow();
  });
});
