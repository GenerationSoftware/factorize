import { ExeIntegrationError } from "../src/exe-vm-backend";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import Ajv2020 from "ajv/dist/2020";
import { ProtectedApiHandler } from "../src/protected-api";
import { ApiService, ServiceError } from "../src/flow-service";
import { InvocationError } from "../src/job-domain";
import type { Env, OAuthProps } from "../src/types";

vi.mock("../src/oauth-connection-settings", () => ({ disabledConnectionScopes: async () => [] }));
vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {
    constructor(
      public ctx: ExecutionContext<OAuthProps>,
      public env: Env,
    ) {}
  },
}));

afterEach(() => vi.restoreAllMocks());
const openapi = parse(
  readFileSync(new URL("../../docs/openapi.yaml", import.meta.url), "utf8"),
);
const auth = {
  tenantId: "tenant-1",
  userId: "user-1",
  sessionVersion: 1,
  authMethod: "session",
  scopes: ["team:read", "triggers:read", "integrations:read", "team:write", "triggers:write", "integrations:write", "runs:read", "runs:invoke", "runs:cancel", "runs:write"],
} as OAuthProps;

function request(
  method: string,
  path: string,
  body?: unknown,
  options: { raw?: string; mediaType?: string; auth?: OAuthProps } = {},
) {
  const identity=options.auth ?? auth;
  const worker = new ProtectedApiHandler(
    { props: identity } as ExecutionContext<OAuthProps>,
    { APP_ORIGIN: "https://example.com", ...(identity.authMethod === "oauth" ? {OAUTH_PROVIDER:{unwrapToken:async()=>({userId:identity.userId,grantId:"boundary-grant",scope:identity.scopes,expiresAt:Math.floor(Date.now()/1000)+3600,grant:{clientId:"boundary-client"}})}} : {}) } as unknown as Env,
  );
  return worker.fetch(
    new Request("https://example.com" + path, {
      method,
      headers: { Origin: "https://example.com", ...(identity.authMethod === "oauth" ? {Authorization:"Bearer validated-boundary-fixture"} : {}), ...(body !== undefined || options.raw !== undefined ? {"Content-Type":options.mediaType ?? "application/json"} : {}) },
      ...(body !== undefined || options.raw !== undefined ? {body: options.raw ?? JSON.stringify(body)} : {}),
    }),
  );
}

async function assertResponse(
  response: Response,
  method: string,
  template: string,
  status: number,
) {
  expect(response.status).toBe(status);
  const mediaType = response.headers.get("content-type")?.split(";")[0];
  const reference =
    openapi.paths[template][method.toLowerCase()].responses[String(status)];
  expect(reference).toBeDefined();
  const documented = reference.$ref
    ? openapi.components.responses[reference.$ref.split("/").at(-1)]
    : reference;
  const schema = documented.content[mediaType!].schema;
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  ajv.addSchema({
    $id: "https://factorize.test/contract",
    components: openapi.components,
  });
  const validate = ajv.compile({
    $id: "https://factorize.test/contract/response",
    components: openapi.components,
    ...schema,
  });
  const body = await response.json();
  expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
  return body as any;
}

const triggerInput = {
  name: "trigger",

  prompt: "Do work",
  executionConfigId: "exe-1",
};

describe("Worker OpenAPI request/response boundaries", () => {
  it("exposes canonical Trigger tools and rejects retired operations and scopes", async () => {
    expect((await request("GET", "/api/v1/jobs")).status).toBe(404);
    expect((await request("GET", "/api/v1/triggers", undefined, { auth: { ...auth, scopes: ["jobs:read"] } })).status).toBe(403);
    const handler = new ProtectedApiHandler({ props: auth } as ExecutionContext<OAuthProps>, { APP_ORIGIN: "https://example.com" } as Env);
    const response = await handler.fetch(new Request("https://example.com/mcp", {
      method: "POST", headers: { Host: "example.com", Origin: "https://example.com", "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    }));
    expect(response.status).toBe(200);
    const text = await response.text();
    const payload = JSON.parse(text.startsWith("{") ? text : text.split("\n").find(line => line.startsWith("data: "))!.slice(6));
    const names = payload.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain("list_triggers");
    expect(names).toContain("invoke_trigger");
    expect(names).not.toContain("list_jobs");
    expect(names).not.toContain("invoke_job");
  });

  it("documents the run launch payload and requires vendor identity without an application scope", async () => {
    const runId = "00000000-0000-4000-8000-000000000001";
    const payload = {version: 1 as const, runId, prompt: "stored prompt", harness: {executable: "codex", args: ["exec"], env: {}}};
    const get = vi.spyOn(ApiService.prototype, "getRuntimeLaunchPayload").mockResolvedValue(payload);
    await assertResponse(await request("GET", "/api/v1/runtime-launch"), "GET", "/api/v1/runtime-launch", 403);
    expect(get).not.toHaveBeenCalled();
    const response = await request("GET", "/api/v1/runtime-launch", undefined, {auth: {...auth, authMethod: "vendor_identity", runId, scopes: []}});
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await assertResponse(response, "GET", "/api/v1/runtime-launch", 200)).toEqual(payload);
    expect(openapi.paths["/api/v1/runtime-launch"].get.security).toEqual([{vendorRunIdentity: [], runIdentityHeader: []}]);
  });

  it("returns a documented JSON array for a read", async () => {
    vi.spyOn(ApiService.prototype, "listTriggers").mockResolvedValue([]);
    expect(
      await assertResponse(
        await request("GET", "/api/v1/triggers"),
        "GET",
        "/api/v1/triggers",
        200,
      ),
    ).toEqual([]);
  });

  it("validates and normalizes trigger input and uses the catalog's 201 status", async () => {
    const create = vi
      .spyOn(ApiService.prototype, "createTrigger")
      .mockResolvedValue({ ...triggerInput, requiresVm:true,runScopes: [], id: "00000000-0000-4000-8000-000000000001", enabled: true, runNameTemplate: "", model: "", effort: "", executionConfig: { connectionId: "exe-1", agentKind: "codex", workspace: "ephemeral", cwd: "/workspace" }, agentKind: "codex", concurrencyLimit: 1, runningCount: 0, currentRuns: 0, maxConcurrency: 1, lastRunState: null, events: [], createdAt: "2026-10-09T12:00:00.000Z", updatedAt: "2026-10-09T12:00:00.000Z" });
    await assertResponse(
      await request("POST", "/api/v1/triggers", triggerInput),
      "POST",
      "/api/v1/triggers",
      201,
    );
    expect(create).toHaveBeenCalledWith({
      ...triggerInput,
      events: [],
    });
    for (const body of [
      {},
      { ...triggerInput, concurrencyLimit: 51 },
      { ...triggerInput, unexpected: true },
    ]) {
      const result = await assertResponse(
        await request("POST", "/api/v1/triggers", body),
        "POST",
        "/api/v1/triggers",
        400,
      );
      expect(result.error.code).toBe("invalid_request");
    }
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("validates parsed method/path parameters and executes the existing service", async () => {
    vi.spyOn(ApiService.prototype as any, "authorize").mockResolvedValue(
      undefined,
    );
    const setEnabled = vi.fn().mockResolvedValue(true);
    vi.spyOn(ApiService.prototype as any, "triggers").mockReturnValue({
      setEnabled,
    });
    const result = await assertResponse(
      await request("POST", "/api/v1/triggers/trigger%20one/disable"),
      "POST",
      "/api/v1/triggers/{triggerId}/disable",
      200,
    );
    expect(result).toEqual({ id: "trigger one", enabled: false });
    expect(setEnabled).toHaveBeenCalledWith(
      "trigger one",
      false,
      expect.any(String),
    );
    await assertResponse(
      await request(
        "GET",
        "/api/v1/providers/github/installations/not-a-number/repositories",
      ),
      "GET",
      "/api/v1/providers/github/installations/{installationId}/repositories",
      400,
    );
    await assertResponse(
      await request("GET", "/api/v1/triggers/%ZZ"),
      "GET",
      "/api/v1/triggers/{triggerId}",
      400,
    );
    await assertResponse(await request("GET", "/api/v1/runs/00000000-0000-4000-8000-000000000001/artifacts/00000000-0000-4000-8000-000000000002", undefined, { auth: { ...auth, scopes: [] } }), "GET", "/api/v1/runs/{runId}/artifacts/{artifactId}", 403);
  });

  it("documents the trigger name in run detail for clients with only runs:read", async () => {
    vi.spyOn(ApiService.prototype, "getRun").mockResolvedValue({source:"manual",prompt_preview:"Prompt",context_prompt:"Prompt", id: "run-1", tenant_id: "tenant", execution_handle: null, trigger_id: "trigger-1", issue_id: "", issue_url: null, issue_title: "", run_name: "", agent_name: "", workspace_name: "", agent_kind: "codex", execution_type: "agent", execution_script: null, execution_configuration: {}, state: "queued", failure_source: null, agent_error: null, provider: "manual", backend_kind: "exe-vm", capabilities: [], destination_url: null, artifact_state: "pending", artifact_error: null, created_at: "2026-10-09T12:00:00.000Z", updated_at: "2026-10-09T12:00:00.000Z", started_at: null, trigger_name: "Trigger name", invocation_id: "invocation", execution_backend_kind: "exe-vm", execution_capabilities: [], claim_released: false, vm_cleanup_attempt: 0, cleanup_next_at: null, vm_cleanup_complete: false, occurrence: {}, invocation_source: "manual", invocation_claim_key: "manual:key", invocation_event_id: null, invocation_created_at: "2026-10-09T12:00:00.000Z", trace_sources: null, trace_projection: null, trace_generation: null, execution_diagnostics: null, harness_log: null, trigger_result: null, run_artifacts: [], prompt: "Prompt", context: {}, invocation: { id: "invocation", source: "manual", claim_key: "manual:key", event_id: null, context: {}, occurrence: {}, source_trigger_id: null, source_run_id: null, created_at: "2026-10-09T12:00:00.000Z" }, activity: [] });
    const result = await assertResponse(await request("GET", "/api/v1/runs/run-1", undefined, { auth: { ...auth, scopes: ["runs:read"] } }), "GET", "/api/v1/runs/{runId}", 200);
    expect(result.trigger_name).toBe("Trigger name");
  });

  it("returns documented 202 invocation bodies and 409 queue errors", async () => {
    const invoke = vi
      .spyOn(ApiService.prototype, "invokeTrigger")
      .mockResolvedValue({
        invocationId: "inv-1",
        runId: "run-1",
        state: "queued",
        duplicate: false,
      });
    await assertResponse(
      await request("POST", "/api/v1/triggers/trigger-1/invocations", {
        data: { issue: "GEN-2152" },
      }),
      "POST",
      "/api/v1/triggers/{triggerId}/invocations",
      202,
    );
    expect(invoke).toHaveBeenCalledWith("trigger-1", {
      prompt: "",
      data: { issue: "GEN-2152" },
    });
    invoke.mockRejectedValue(
      new InvocationError("queue_full", "Queue is full"),
    );
    const result = await assertResponse(
      await request("POST", "/api/v1/triggers/trigger-1/invocations", {}),
      "POST",
      "/api/v1/triggers/{triggerId}/invocations",
      409,
    );
    expect(result.error.code).toBe("queue_full");
    await assertResponse(
      await request("POST", "/api/v1/triggers/trigger-1/invocations", {
        idempotencyKey: "manual:reserved",
      }),
      "POST",
      "/api/v1/triggers/{triggerId}/invocations",
      400,
    );
  });

  it("rejects malformed JSON and unsupported media types before invoking the service", async () => {
    const create = vi.spyOn(ApiService.prototype, "createTrigger");
    const malformed = await assertResponse(
      await request("POST", "/api/v1/triggers", undefined, { raw: "{" }),
      "POST",
      "/api/v1/triggers",
      400,
    );
    expect(malformed.error.code).toBe("invalid_request");
    await assertResponse(
      await request("POST", "/api/v1/triggers", triggerInput, {
        mediaType: "text/plain",
      }),
      "POST",
      "/api/v1/triggers",
      415,
    );
    await assertResponse(
      await request("POST", "/api/v1/triggers", null),
      "POST",
      "/api/v1/triggers",
      400,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it.each(["access_token", "oauth"] as const)("does not grant skill access to %s credentials without skill scopes", async authMethod => {
    const limited = { ...auth, authMethod, scopes: ["triggers:read", "triggers:write"] } as OAuthProps;
    await assertResponse(await request("GET", "/api/v1/skills", undefined, { auth: limited }), "GET", "/api/v1/skills", 403);
    await assertResponse(await request("POST", "/api/v1/skills", { key: "review", body: "Review carefully" }, { auth: limited }), "POST", "/api/v1/skills", 403);
  });

  it("enforces scope and interactive-session metadata and preserves service identity errors", async () => {
    const list = vi.spyOn(ApiService.prototype, "listTriggers");
    const denied = await request("GET", "/api/v1/triggers", undefined, {
      auth: { ...auth, scopes: [] },
    });
    expect(denied.headers.get("www-authenticate")).toContain(
      "insufficient_scope",
    );
    await assertResponse(denied, "GET", "/api/v1/triggers", 403);
    expect(list).not.toHaveBeenCalled();
    list.mockRejectedValue(
      new ServiceError(401, "invalid_token", "Session revoked"),
    );
    await assertResponse(
      await request("GET", "/api/v1/triggers"),
      "GET",
      "/api/v1/triggers",
      401,
    );
    await assertResponse(
      await request("GET", "/api/v1/access-tokens", undefined, {
        auth: { ...auth, authMethod: "access_token" },
      }),
      "GET",
      "/api/v1/access-tokens",
      403,
    );
    await assertResponse(
      await request(
        "POST",
        "/api/v1/runs/11111111-1111-4111-8111-111111111111/trace/replay",
        { requestId: "11111111-1111-4111-8111-111111111111" },
        { auth: { ...auth, authMethod: "access_token" } },
      ),
      "POST",
      "/api/v1/runs/{runId}/trace/replay",
      403,
    );
  });

  it("validates pagination and trace query limits and returns documented page schemas", async () => {
    const list = vi
      .spyOn(ApiService.prototype, "listRuns")
      .mockResolvedValue({ items: [], nextCursor: null });
    await assertResponse(
      await request("GET", "/api/v1/runs?limit=100&sort=agent&direction=desc"),
      "GET",
      "/api/v1/runs",
      200,
    );
    expect(list.mock.calls[0][0].get("limit")).toBe("100");
    expect(list.mock.calls[0][0].get("sort")).toBe("agent");
    expect(list.mock.calls[0][0].get("direction")).toBe("desc");
    for (const query of ["limit=0", "limit=101", "limit=NaN", "state=invalid", "sort=invalid", "direction=asc"])
      await assertResponse(
        await request("GET", "/api/v1/runs?" + query),
        "GET",
        "/api/v1/runs",
        400,
      );
    const trace = vi
      .spyOn(ApiService.prototype, "getRunTrace")
      .mockResolvedValue({ items: [], nextCursor: null });
    await assertResponse(
      await request("GET", "/api/v1/runs/run-1/trace?after=0&limit=200"),
      "GET",
      "/api/v1/runs/{runId}/trace",
      200,
    );
    expect(trace).toHaveBeenCalledWith("run-1", 0, 200);
    for (const query of ["after=-1", "after=NaN", "limit=201"])
      await assertResponse(
        await request("GET", "/api/v1/runs/run-1/trace?" + query),
        "GET",
        "/api/v1/runs/{runId}/trace",
        400,
      );
  });

  it("validates bounded reads and preserves scope enforcement for every additive resource", async () => {
    const summaries = vi.spyOn(ApiService.prototype, "listTriggerSummaries").mockResolvedValue({ items: [], nextCursor: null });
    for (const path of ["/api/v1/trigger-summaries", "/api/v1/trigger-selector"]) {
      await assertResponse(await request("GET", path + "?limit=2&q=Review&enabled=true"), "GET", path, 200);
      await assertResponse(await request("GET", path + "?limit=101"), "GET", path, 400);
      await assertResponse(await request("GET", path + "?cursor=broken"), "GET", path, 400);
      await assertResponse(await request("GET", path + "?sort=title&cursor=00000000-0000-4000-8000-000000000001"), "GET", path, 400);
      await assertResponse(await request("GET", path + "?sort=title&cursor=00000000-0000-4000-8000-000000000001"), "GET", path, 400);
      await assertResponse(await request("GET", path, undefined, { auth: { ...auth, scopes: ["runs:read"] } }), "GET", path, 403);
    }
    expect(summaries).toHaveBeenCalledWith({ limit: 2, q: "Review", enabled: "true" }, true);
    const metadata = vi.spyOn(ApiService.prototype, "eventContextMetadata").mockResolvedValue({ manual: [{ path: "prompt", type: "string", description: "Manual prompt" }] });
    await assertResponse(await request("GET", "/api/v1/event-contexts"), "GET", "/api/v1/event-contexts", 200);
    expect(metadata).toHaveBeenCalledOnce();
    const trace = vi.spyOn(ApiService.prototype, "getRevisionTrace").mockResolvedValue({ items: [], nextCursor: null, revision: "rev", reset: true });
    await assertResponse(await request("GET", "/api/v1/runs/00000000-0000-4000-8000-000000000001/trace-pages?revision=old&after=100&limit=2"), "GET", "/api/v1/runs/{runId}/trace-pages", 200);
    expect(trace).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000001", 100, 2, "old");
    await assertResponse(await request("GET", "/api/v1/runs/00000000-0000-4000-8000-000000000001/trace-pages?limit=201"), "GET", "/api/v1/runs/{runId}/trace-pages", 400);
    await assertResponse(await request("GET", "/api/v1/runs/00000000-0000-4000-8000-000000000001/status", undefined, { auth: { ...auth, scopes: ["team:read", "triggers:read", "integrations:read"] } }), "GET", "/api/v1/runs/{runId}/status", 403);
  });

  it("rejects undeclared methods and paths at the Worker boundary", async () => {
    expect((await request("PATCH", "/api/v1/triggers")).status).toBe(404);
    expect((await request("GET", "/api/v1/unknown")).status).toBe(404);
    const missing = vi
      .spyOn(ApiService.prototype, "getTrigger")
      .mockRejectedValue(new ServiceError(404, "not_found", "Trigger not found"));
    await assertResponse(
      await request("GET", "/api/v1/triggers/missing"),
      "GET",
      "/api/v1/triggers/{triggerId}",
      404,
    );
    expect(missing).toHaveBeenCalledWith("missing");
  });
});


describe("exe integration validation errors", () => {
  it("returns actionable validation failures through the public API", async () => {
    vi.spyOn(ApiService.prototype, "saveExeIntegration").mockRejectedValue(new ExeIntegrationError("exe.dev token is missing required permissions: rm"));
    const response = await request("PUT", "/api/v1/integrations/exe", { apiToken: "test", tags: [] });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "invalid_request", message: "exe.dev token is missing required permissions: rm" } });
  });
});
