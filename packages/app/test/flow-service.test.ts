import { describe, expect, it } from "vitest";
import { ApiService, ServiceError } from "../src/flow-service";
import { jobInputSchema, listRunsSchema, manualInvocationSchema } from "../src/flow-schemas";
import type { Env, OAuthProps } from "../src/types";

function environment(handler: (request: Request) => Response | Promise<Response>): Env {
  const stub = { fetch: (input: RequestInfo | URL, init?: RequestInit) => handler(new Request(input, init)) } as DurableObjectStub;
  return { TENANTS: { idFromName: (name: string) => name as unknown as DurableObjectId, get: () => stub } as unknown as DurableObjectNamespace } as Env;
}

const auth: OAuthProps = { tenantId: "tenant-a", userId: "owner-a", sessionVersion: 4, scopes: ["flows:read", "runs:read"] };

describe("ApiService", () => {
  it("invalidates tokens when the owner session version changes", async () => {
    const requests: Request[] = [];
    const service = new ApiService(environment(request => {
      requests.push(request);
      return Response.json({ error: "The resource owner's session has been revoked." }, { status: 401 });
    }), auth);
    await expect(service.listJobs()).rejects.toMatchObject({ status: 401, code: "invalid_token" });
    const authorizationRequests = requests.filter(request => new URL(request.url).pathname === "/authorize");
    expect(authorizationRequests).toHaveLength(1);
  });

  it("uses flow scopes for job management and run scopes for invocation", async () => {
    const requests: string[] = [];
    const service = new ApiService(environment(request => {
      const path = new URL(request.url).pathname;
      if (path === "/authorize") return Response.json({ authorized: true });
      requests.push(`${request.method} ${path}`);
      return Response.json({ ok: true });
    }), { ...auth, scopes: ["flows:read", "flows:write", "runs:write"] });
    await service.createJob({ name: "Manual", slug: "manual", promptTemplate: "{{trigger-1.prompt}}", concurrencyLimit: 1, executionTargetId: "target-1", triggers: [] });
    await service.invokeJob("job-1", { prompt: "go", idempotencyKey: "client-1" });
    expect(requests).toEqual(["POST /v1/jobs", "POST /v1/jobs/job-1/invocations"]);
  });

  it("lists safe GitHub installation metadata with the flow read scope", async () => {
    const installations = [{ installationId: 123, accountLogin: "generation", accountType: "Organization", state: "active", updatedAt: "2026-09-17T00:00:00.000Z" }];
    const service = new ApiService(environment(request => {
      const path = new URL(request.url).pathname;
      if (path === "/authorize") return Response.json({ authorized: true });
      if (path === "/github/installations") return Response.json(installations);
      return new Response("Not found", { status: 404 });
    }), auth);

    await expect(service.listGitHubInstallations()).resolves.toEqual(installations);
    expect(JSON.stringify(installations)).not.toMatch(/token|secret|credential/i);
  });
});

describe("authorization round trip", () => {
  it.each([
    ["valid", Response.json({ authorized: true }), undefined],
    ["revoked token", Response.json({ error: "The access token has expired or been revoked." }, { status: 401 }), "The access token has expired or been revoked."],
    ["removed member", Response.json({ error: "The resource owner is no longer a member." }, { status: 401 }), "The resource owner is no longer a member."],
    ["session mismatch", Response.json({ error: "The resource owner's session has been revoked." }, { status: 401 }), "The resource owner's session has been revoked."],
  ])("handles %s authorization in one request", async (_name, response, message) => {
    const requests: Request[] = [];
    const service = new ApiService(environment(request => {
      requests.push(request);
      return new URL(request.url).pathname === "/authorize" ? response : Response.json([]);
    }), auth);
    if (message) await expect(service.listJobs()).rejects.toMatchObject({ status: 401, message });
    else {
      const result = await service.listJobs();
      expect(result).toEqual([]);
    }
    const authorizationRequests = requests.filter(request => new URL(request.url).pathname === "/authorize");
    expect(authorizationRequests).toHaveLength(1);
    expect(new URL(authorizationRequests[0].url).pathname).toBe("/authorize");
  });
});

describe("shared API schemas", () => {
  it("bounds pagination and run states", () => {
    expect(listRunsSchema.parse({ limit: "100", state: "running", contextQuery: "literal.*text" })).toMatchObject({ limit: 100, state: "running", contextQuery: "literal.*text" });
    expect(() => listRunsSchema.parse({ limit: "101" })).toThrow();
    expect(() => listRunsSchema.parse({ contextQuery: "" })).toThrow();
  });

  it("validates job configuration and reserved invocation context", () => {
    const job = jobInputSchema.parse({ name: "Deploy", slug: "deploy", promptTemplate: "Deploy {{trigger-1.prompt}}", model: "gpt-5.5", concurrencyLimit: 2, executionTargetId: "exe-1", triggers: [{ kind: "schedule", config: { cron: "0 * * * *", timezone: "UTC" } }, { kind: "jobLifecycle", config: { sourceJobIds: ["worker"], states: ["succeeded", "failed"] } }] });
    expect(job.model).toBe("gpt-5.5");
    expect(job.triggers.map(trigger => trigger.kind)).toEqual(["schedule", "jobLifecycle"]);
    expect(() => jobInputSchema.parse({ ...job, apiToken: "secret" })).toThrow();
    expect(() => jobInputSchema.parse({ ...job, parameterDefaults: {} })).toThrow();
    expect(() => manualInvocationSchema.parse({ parameters: {} })).toThrow();
    expect(manualInvocationSchema.parse({ prompt: "ticket" })).toMatchObject({ prompt: "ticket" });
    expect(manualInvocationSchema.parse({ idempotencyKey: "dev-dispatch-gen-2032" })).toMatchObject({ idempotencyKey: "dev-dispatch-gen-2032" });
    expect(() => manualInvocationSchema.parse({ idempotencyKey: "manual:dev-dispatch-gen-2032" })).toThrow(/reserved manual: claim-key prefix/);
  });
});
