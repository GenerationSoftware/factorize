import { describe, expect, it, vi } from "vitest";
import { protectedApiFetch } from "../src/protected-api";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));

const ownerOnlyOperations = [
  ["GET", "/api/v1/integrations/bearer"],
  ["POST", "/api/v1/integrations/bearer"],
  ["GET", "/api/v1/model-accounts"],
  ["POST", "/api/v1/model-accounts"],
  ["POST", "/api/v1/model-accounts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/browser-capability"],
  ["GET", "/api/v1/unlock-key/verification"],
  ["POST", "/api/v1/unlock-key/verification"],
  ["GET", "/api/v1/unlock-key/rotation-snapshot"],
  ["POST", "/api/v1/unlock-key/rotation"],
] as const;

describe("credential and model-account management authorization", () => {
  it.each(["access_token", "oauth"] as const)("rejects %s credentials even when granted integration write", async authMethod => {
    const auth = {
      tenantId: "tenant-fixture",
      userId: "owner-fixture",
      sessionVersion: 1,
      authMethod,
      scopes: ["integrations:read", "integrations:write", "jobs:write"],
    } as any;
    for (const [method, path] of ownerOnlyOperations) {
      const response = await protectedApiFetch(new Request(`https://app.example${path}`, {
        method,
        headers: {
          Origin: "https://app.example",
          "Content-Type": "application/json",
          ...(method === "POST" ? {} : {}),
        },
        ...(method === "POST" ? { body: "{}" } : {}),
      }), { APP_ORIGIN: "https://app.example" } as any, auth, {} as any);
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(await response.json(), `${method} ${path}`).toMatchObject({ error: { code: "session_required" } });
    }
  });

  it("rejects a cross-origin interactive mutation before service access", async () => {
    const response = await protectedApiFetch(new Request("https://app.example/api/v1/integrations/bearer", {
      method: "POST",
      headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
      body: "{}",
    }), { APP_ORIGIN: "https://app.example" } as any, {
      tenantId: "tenant-fixture", userId: "owner-fixture", sessionVersion: 1,
      authMethod: "session", scopes: ["integrations:write"],
    } as any, {} as any);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_origin" } });
  });
});
