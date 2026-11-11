import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { decrypt } from "../src/crypto";
import { createFlyAccountClient } from "../src/fly-account-client";
import { FlyConnectionRepository } from "../src/postgres/fly-connection-repository";
import { protectedApiFetch } from "../src/protected-api";
import { loadingFixture } from "./helpers/loading-fixture";
import type { OAuthProps } from "../src/types";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));

const url = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!url)("Fly account connection (PostgreSQL/API)", () => {
  let fixture: Awaited<ReturnType<typeof loadingFixture>>;
  beforeAll(async () => { fixture = await loadingFixture(url!); });
  afterAll(async () => { vi.unstubAllGlobals(); await fixture?.cleanup(); });

  function request(method: string, auth: OAuthProps, body?: unknown, path = "/api/v1/fly/connection") {
    return protectedApiFetch(new Request(fixture.env.APP_ORIGIN + path, {
      method,
      headers: { Origin: fixture.env.APP_ORIGIN, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), fixture.env, auth, { waitUntil() {} } as any);
  }

  it("enforces one connection per tenant, isolates tenants, and keeps credentials secret-free on reads", async () => {
    const first = new FlyConnectionRepository(fixture.db, fixture.tenantId, fixture.env.CREDENTIAL_ENCRYPTION_KEY);
    const other = new FlyConnectionRepository(fixture.db, fixture.otherTenant, fixture.env.CREDENTIAL_ENCRYPTION_KEY);
    const firstToken = "synthetic-fly-token-one";
    await first.save({ organizationSlug: "alpha", organizationName: "Alpha" }, firstToken);
    await first.save({ organizationSlug: "beta", organizationName: "Beta" }, "synthetic-fly-token-two");
    expect(await first.get()).toEqual({ organizationSlug: "beta", organizationName: "Beta" });
    expect(await other.get()).toBeNull();
    expect(await other.remove()).toBe(false);
    const rows = await fixture.db.pool.query("SELECT tenant_id,organization_slug,encrypted_token FROM app.fly_connections ORDER BY tenant_id");
    expect(rows.rows.filter(row => row.tenant_id === fixture.tenantId)).toHaveLength(1);
    expect(rows.rows.find(row => row.tenant_id === fixture.tenantId)!.encrypted_token).not.toContain("synthetic-fly-token-two");
    expect(await first.token()).toBe("synthetic-fly-token-two");
    expect(await decrypt(rows.rows.find(row => row.tenant_id === fixture.tenantId)!.encrypted_token, fixture.env.CREDENTIAL_ENCRYPTION_KEY)).toBe("synthetic-fly-token-two");
  });

  it("validates and saves in the browser API without returning the token or creating resources", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const request = new URL(String(input)); urls.push(request.toString());
      return Response.json({ tokens: [{ org_slug: "alpha", organization: "Alpha Org" }] });
    });
    const auth = { ...fixture.auth, scopes: ["integrations:read", "integrations:write"] };
    const token = "synthetic-fly-secret";
    const validated = await request("POST", auth, { token, organizationSlug: "alpha" }, "/api/v1/fly/connection/test");
    expect(validated.status).toBe(200);
    expect(await validated.json()).toEqual({ valid: true, connection: { organizationSlug: "alpha", organizationName: "Alpha Org" } });
    const saved = await request("PUT", auth, { token, organizationSlug: "alpha" });
    expect(saved.status).toBe(200);
    expect(JSON.stringify(await saved.json())).not.toContain(token);
    const read = await request("GET", auth);
    expect(await read.json()).toEqual({ connection: { organizationSlug: "alpha", organizationName: "Alpha Org" } });
    expect(urls).toEqual(["https://api.machines.dev/v1/tokens/current", "https://api.machines.dev/v1/tokens/current"]);
    expect((await fixture.db.pool.query("SELECT encrypted_token FROM app.fly_connections WHERE tenant_id=$1", [fixture.tenantId])).rows[0].encrypted_token).not.toContain(token);
  });

  it("denies agent credentials even when integrations:write is granted", async () => {
    const agent = { ...fixture.auth, authMethod: "run_token", scopes: ["integrations:write"] } as OAuthProps;
    const response = await request("PUT", agent, { token: "secret", organizationSlug: "alpha" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "session_required" } });
  });

  it("maps fake-provider authentication and organization failures to sanitized API errors", async () => {
    const auth = { ...fixture.auth, scopes: ["integrations:write"] };
    for (const [status, payload, expected] of [
      [401, { error: "rejected synthetic-fly-secret" }, { status: 401, code: "fly_auth_failed", message: "Fly authentication failed" }],
      [200, { tokens: [{ org_slug: "other", organization: "Other Org" }] }, { status: 400, code: "fly_organization_unavailable", message: "Fly organization is unavailable to this token" }],
    ] as const) {
      vi.stubGlobal("fetch", async () => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }));
      const response = await request("POST", auth, { token: "synthetic-fly-secret", organizationSlug: "alpha" }, "/api/v1/fly/connection/test");
      expect(response.status).toBe(expected.status);
      const body = await response.json() as any;
      expect(body.error).toMatchObject({ code: expected.code, message: expected.message });
      expect(JSON.stringify(body)).not.toContain("synthetic-fly-secret");
      expect(JSON.stringify(body)).not.toContain("rejected");
    }
  });
});

describe("Fly account validation errors", () => {
  const client = (status: number, body: unknown) => createFlyAccountClient({
    apiOrigin: "https://fly.test",
    fetch: async (input, init) => {
      expect(String(input)).toBe("https://fly.test/v1/tokens/current");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer synthetic-token");
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    },
  });
  it("sanitizes provider authentication and organization errors", async () => {
    await expect(client(401, { error: "bad synthetic-token" }).validate("synthetic-token", "alpha"))
      .rejects.toMatchObject({ name: "FlyAccountError", kind: "auth", message: "Fly authentication failed" });
    await expect(client(200, { tokens: [{ org_slug: "beta", organization: "Beta" }] }).validate("synthetic-token", "alpha"))
      .rejects.toMatchObject({ name: "FlyAccountError", kind: "organization", message: "Fly organization is unavailable to this token" });
  });
});
