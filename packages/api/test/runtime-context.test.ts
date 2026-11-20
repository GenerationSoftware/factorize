import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/worker";
import { protectedApiFetch } from "../src/protected-api";
import { DEFAULT_RUN_SCOPES as RUN_SCOPES } from "../src/run-scopes";
import { IdentityRepository } from "../src/postgres/identity-repository";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({
  OAuthProvider: class { fetch() { throw new Error("Unexpected OAuth dispatch"); } },
  AuthorizationError: class extends Error {}, getOAuthApi: vi.fn(),
}));
afterEach(() => vi.restoreAllMocks());

describe("run proxy identity boundary", () => {
  it("reports a verified run with an empty scope snapshot", async () => {
    vi.spyOn(IdentityRepository.prototype, "member").mockResolvedValue({role:"owner",sessionVersion:1} as any);
    const response=await protectedApiFetch(new Request("https://app.test/api/v1/runtime-context"), {DATABASE:{}} as any,
      {tenantId:"tenant",userId:"owner",sessionVersion:1,authMethod:"vendor_identity",runId:"run",runTriggerId:"source",runIdentityProvider:"fly.io",scopes:[]},{} as any);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({authMethod:"vendor_identity",runId:"run",triggerId:"source",scopes:[]});
  });

  it("can verify that an integration is read-only", async () => {
    vi.spyOn(IdentityRepository.prototype, "member").mockResolvedValue({ role: "owner", sessionVersion: 1 } as any);
    const response = await protectedApiFetch(new Request("https://app.test/api/v1/runtime-context"), { DATABASE: {} } as any,
      { tenantId: "tenant", userId: "owner", sessionVersion: 1, authMethod: "access_token", scopes: ["runs:read"] }, {} as ExecutionContext);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ scopes: ["runs:read"] });
    expect(RUN_SCOPES).not.toContain("triggers:write");
  });

  it("distinguishes a broader owner credential from the required run proxy", async () => {
    vi.spyOn(IdentityRepository.prototype, "member").mockResolvedValue({ role: "owner", sessionVersion: 1 } as any);
    const response = await protectedApiFetch(new Request("https://app.test/api/v1/runtime-context"), { DATABASE: {} } as any,
      { tenantId: "tenant", userId: "owner", sessionVersion: 1, authMethod: "oauth", scopes: ["runs:read", "runs:invoke"] }, {} as ExecutionContext);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ kind: "factorize-runtime-context-v1", authMethod: "oauth", runId: null, triggerId: null, scopes: ["runs:read", "runs:invoke"] });
  });
});
