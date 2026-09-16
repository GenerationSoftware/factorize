import { describe, expect, it } from "vitest";
import { FlowService, ServiceError } from "../src/flow-service";
import { flowInputSchema, jobInputSchema, listRunsSchema, manualInvocationSchema } from "../src/flow-schemas";
import type { Env, OAuthProps } from "../src/types";

function environment(handler: (request: Request) => Response | Promise<Response>): Env {
  const stub = { fetch: (input: RequestInfo | URL, init?: RequestInit) => handler(new Request(input, init)) } as DurableObjectStub;
  return { TENANTS: { idFromName: (name: string) => name as unknown as DurableObjectId, get: () => stub } as unknown as DurableObjectNamespace } as Env;
}

const auth: OAuthProps = { tenantId: "tenant-a", userId: "owner-a", sessionVersion: 4, scopes: ["flows:read", "runs:read"] };

describe("FlowService", () => {
  it("checks current owner membership on every call", async () => {
    let membershipChecks = 0;
    const service = new FlowService(environment(request => {
      const path = new URL(request.url).pathname;
      if (path === "/members/owner-a") { membershipChecks++; return Response.json({ role: "owner", session_version: 4 }); }
      if (path === "/pipes") return Response.json([{ id: "flow-1", name: "Triage" }]);
      return new Response("Not found", { status: 404 });
    }), auth);
    await service.listFlows(); await service.listFlows();
    expect(membershipChecks).toBe(2);
  });

  it("rejects missing mutation scopes before touching flow storage", async () => {
    let mutated = false;
    const service = new FlowService(environment(request => {
      if (new URL(request.url).pathname === "/pipes" && request.method === "POST") mutated = true;
      return Response.json({ role: "owner", session_version: 4 });
    }), auth);
    await expect(service.createFlow({ name: "Triage", source: { kind: "linear", projectId: "p", matchRules: [{ type: "label", targetId: "l" }] }, exeConnectionId: "exe-1", maxConcurrency: 3 })).rejects.toMatchObject({ status: 403, code: "insufficient_scope" } satisfies Partial<ServiceError>);
    expect(mutated).toBe(false);
  });

  it("invalidates tokens when the owner session version changes", async () => {
    const service = new FlowService(environment(() => Response.json({ role: "owner", session_version: 5 })), auth);
    await expect(service.listFlows()).rejects.toMatchObject({ status: 401, code: "invalid_token" });
  });

  it("uses flow scopes for job management and run scopes for invocation", async () => {
    const requests: string[] = [];
    const service = new FlowService(environment(request => {
      const path = new URL(request.url).pathname;
      if (path === "/members/owner-a") return Response.json({ role: "owner", session_version: 4 });
      requests.push(`${request.method} ${path}`);
      return Response.json({ ok: true });
    }), { ...auth, scopes: ["flows:read", "flows:write", "runs:write"] });
    await service.createJob({ name: "Manual", promptTemplate: "{{context}}", parameterDefaults: {}, concurrencyLimit: 1, executionTargetId: "target-1", trigger: { kind: "manual", config: {} } });
    await service.invokeJob("job-1", { parameters: {}, idempotencyKey: "client-1" });
    expect(requests).toEqual(["POST /v1/jobs", "POST /v1/jobs/job-1/invocations"]);
  });
});

describe("shared API schemas", () => {
  it("rejects credential and unknown fields", () => {
    expect(() => flowInputSchema.parse({ name: "Triage", source: { kind: "linear", projectId: "p", matchRules: [{ type: "label", targetId: "l" }] }, exeConnectionId: "exe-1", maxConcurrency: 3, apiToken: "secret" })).toThrow();
    expect(flowInputSchema.parse({ name: "Tail", source: { kind: "cloudflareTail" }, exeConnectionId: "exe-1" }).source.kind).toBe("cloudflareTail");
    expect(() => flowInputSchema.parse({ name: "Tail", source: { kind: "cloudflareTail", signingSecret: "nope" }, exeConnectionId: "exe-1" })).toThrow();
  });

  it("bounds pagination and run states", () => {
    expect(listRunsSchema.parse({ limit: "100", state: "running" })).toMatchObject({ limit: 100, state: "running" });
    expect(() => listRunsSchema.parse({ limit: "101" })).toThrow();
  });

  it("validates job configuration and reserved invocation context", () => {
    const job = jobInputSchema.parse({ name: "Deploy", promptTemplate: "Deploy {{environment}}: {{context}}", parameterDefaults: { environment: "staging" }, concurrencyLimit: 2, executionTargetId: "exe-1", trigger: { kind: "schedule", config: { cron: "0 * * * *" } } });
    expect(job.trigger.kind).toBe("schedule");
    expect(() => jobInputSchema.parse({ ...job, apiToken: "secret" })).toThrow();
    expect(() => jobInputSchema.parse({ ...job, parameterDefaults: { context: "wrong" } })).toThrow();
    expect(() => manualInvocationSchema.parse({ parameters: { context: "wrong" } })).toThrow();
    expect(manualInvocationSchema.parse({ context: "ticket", parameters: { environment: "prod" } })).toMatchObject({ context: "ticket" });
  });
});
