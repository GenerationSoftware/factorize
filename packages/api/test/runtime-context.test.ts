import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/worker";
import { protectedApiFetch } from "../src/protected-api";
import { issueRunCredential, RUN_SCOPES } from "../src/run-credentials";
import { IdentityRepository } from "../src/postgres/identity-repository";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({
  OAuthProvider: class { fetch() { throw new Error("Unexpected OAuth dispatch"); } },
  AuthorizationError: class extends Error {}, getOAuthApi: vi.fn(),
}));
afterEach(() => vi.restoreAllMocks());

describe("run proxy identity boundary", () => {
  it("authenticates an injected bearer, exposes its own identity, and rejects it when inactive", async () => {
    let digest = "", active = true;
    const runId = "00000000-0000-4000-8000-000000000001";
    const database = { pool: { query: async (sql: string, values: unknown[] = []) => {
      if (sql.includes("SELECT user_id,session_version")) return { rows: [{ user_id: "owner", session_version: 1 }] };
      if (sql.includes("INSERT INTO app.run_credentials")) { digest = String(values[2]); return { rows: [] }; }
      if (sql.includes("FROM app.run_credentials c")) return { rows: active && values[1] === digest ? [{ tenant_id: "tenant", user_id: "owner", session_version: 1, job_id: "source", scopes: RUN_SCOPES }] : [] };
      throw new Error("Unexpected database operation");
    } } };
    const env = { DATABASE: database, APP_ORIGIN: "https://app.test" } as any;
    vi.spyOn(IdentityRepository.prototype, "member").mockResolvedValue({ role: "owner", sessionVersion: 1 } as any);
    const token = await issueRunCredential(env, "tenant", runId);
    const request = (path: string, method = "GET") => worker.fetch(new Request(env.APP_ORIGIN + path, { method, headers: { Authorization: `Bearer ${token}` } }), env, {} as ExecutionContext);
    const response = await request("/api/v1/runtime-context");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ kind: "factorize-runtime-context-v1", authMethod: "run_token", runId, jobId: "source", scopes: RUN_SCOPES });
    const write = await request("/api/v1/jobs/source", "DELETE");
    expect(write.status).toBe(403);
    expect(await write.json()).toMatchObject({ error: { code: "insufficient_scope" } });
    active = false;
    expect((await request("/api/v1/runtime-context")).status).toBe(401);
  });

  it("can verify that an integration is read-only", async () => {
    vi.spyOn(IdentityRepository.prototype, "member").mockResolvedValue({ role: "owner", sessionVersion: 1 } as any);
    const response = await protectedApiFetch(new Request("https://app.test/api/v1/runtime-context"), { DATABASE: {} } as any,
      { tenantId: "tenant", userId: "owner", sessionVersion: 1, authMethod: "access_token", scopes: ["runs:read"] }, {} as ExecutionContext);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ scopes: ["runs:read"] });
    expect(RUN_SCOPES).not.toContain("jobs:write");
  });

  it("distinguishes a broader owner credential from the required run proxy", async () => {
    vi.spyOn(IdentityRepository.prototype, "member").mockResolvedValue({ role: "owner", sessionVersion: 1 } as any);
    const response = await protectedApiFetch(new Request("https://app.test/api/v1/runtime-context"), { DATABASE: {} } as any,
      { tenantId: "tenant", userId: "owner", sessionVersion: 1, authMethod: "oauth", scopes: ["runs:read", "runs:invoke"] }, {} as ExecutionContext);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ kind: "factorize-runtime-context-v1", authMethod: "oauth", runId: null, jobId: null, scopes: ["runs:read", "runs:invoke"] });
  });
});
