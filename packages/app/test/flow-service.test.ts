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
    const service = new ApiService(environment(() => Response.json({ role: "owner", session_version: 5 })), auth);
    await expect(service.listJobs()).rejects.toMatchObject({ status: 401, code: "invalid_token" });
  });

  it("uses flow scopes for job management and run scopes for invocation", async () => {
    const requests: string[] = [];
    const service = new ApiService(environment(request => {
      const path = new URL(request.url).pathname;
      if (path === "/members/owner-a") return Response.json({ role: "owner", session_version: 4 });
      requests.push(`${request.method} ${path}`);
      return Response.json({ ok: true });
    }), { ...auth, scopes: ["flows:read", "flows:write", "runs:write"] });
    await service.createJob({ name: "Manual", promptTemplate: "{{trigger-1.prompt}}", concurrencyLimit: 1, executionTargetId: "target-1", triggers: [] });
    await service.invokeJob("job-1", { prompt: "go", idempotencyKey: "client-1" });
    expect(requests).toEqual(["POST /v1/jobs", "POST /v1/jobs/job-1/invocations"]);
  });
});

describe("shared API schemas", () => {
  it("bounds pagination and run states", () => {
    expect(listRunsSchema.parse({ limit: "100", state: "running", contextQuery: "literal.*text" })).toMatchObject({ limit: 100, state: "running", contextQuery: "literal.*text" });
    expect(() => listRunsSchema.parse({ limit: "101" })).toThrow();
    expect(() => listRunsSchema.parse({ contextQuery: "" })).toThrow();
  });

  it("validates job configuration and reserved invocation context", () => {
    const job = jobInputSchema.parse({ name: "Deploy", promptTemplate: "Deploy {{trigger-1.prompt}}", concurrencyLimit: 2, executionTargetId: "exe-1", triggers: [{ kind: "schedule", config: { cron: "0 * * * *", timezone: "UTC" } }, { kind: "jobLifecycle", config: { sourceJobIds: ["worker"], states: ["succeeded", "failed"] } }] });
    expect(job.triggers.map(trigger => trigger.kind)).toEqual(["schedule", "jobLifecycle"]);
    expect(() => jobInputSchema.parse({ ...job, apiToken: "secret" })).toThrow();
    expect(() => jobInputSchema.parse({ ...job, parameterDefaults: {} })).toThrow();
    expect(() => manualInvocationSchema.parse({ parameters: {} })).toThrow();
    expect(manualInvocationSchema.parse({ prompt: "ticket" })).toMatchObject({ prompt: "ticket" });
  });
});
