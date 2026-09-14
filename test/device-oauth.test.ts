import { describe, expect, it, vi } from "vitest";
import { addDeviceMetadata, DEVICE_GRANT, deviceAuthorization, deviceClientRegistration, deviceToken, deviceVerification } from "../src/device-oauth";
import type { Env } from "../src/types";

class MemoryKv {
  values = new Map<string, string>();
  async get<T = string>(key: string, type?: string): Promise<T | string | null> {
    const value = this.values.get(key);
    if (value === undefined) return null;
    return (type === "json" ? JSON.parse(value) : value) as T;
  }
  async put(key: string, value: string): Promise<void> { this.values.set(key, value); }
  async delete(key: string): Promise<void> { this.values.delete(key); }
}

function environment(kv: MemoryKv): Env {
  return {
    APP_ORIGIN: "https://factorize.test",
    SESSION_SIGNING_SECRET: "session-secret",
    OAUTH_KV: kv as unknown as KVNamespace,
  } as Env;
}

const publicClient = { clientId: "client-1", clientName: "Codex", redirectUris: ["http://127.0.0.1/callback"], tokenEndpointAuthMethod: "none" };

describe("OAuth device authorization", () => {
  it("issues RFC 8628 device and user codes", async () => {
    const kv = new MemoryKv(), env = environment(kv);
    const response = await deviceAuthorization(new Request("https://factorize.test/oauth/device_authorization", {
      method: "POST", body: new URLSearchParams({ client_id: "client-1", scope: "runs:read", resource: "https://factorize.test/mcp" }),
    }), env, { lookupClient: vi.fn().mockResolvedValue(publicClient), completeAuthorization: vi.fn() }, ["flows:read", "runs:read"]);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.device_code).toBeTruthy();
    expect(body.user_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(body.verification_uri).toBe("https://factorize.test/device");
    expect(body.verification_uri_complete).toContain(encodeURIComponent(body.user_code));
    expect(body.expires_in).toBe(600);
    expect(body.interval).toBe(5);
  });

  it("rejects unsupported scopes and resources", async () => {
    const env = environment(new MemoryKv());
    const oauth = { lookupClient: vi.fn().mockResolvedValue(publicClient), completeAuthorization: vi.fn() };
    const badScope = await deviceAuthorization(new Request("https://factorize.test/oauth/device_authorization", { method: "POST", body: new URLSearchParams({ client_id: "client-1", scope: "runs:write" }) }), env, oauth, ["flows:read", "runs:read"]);
    await expect(badScope.json()).resolves.toMatchObject({ error: "invalid_scope" });
    const badResource = await deviceAuthorization(new Request("https://factorize.test/oauth/device_authorization", { method: "POST", body: new URLSearchParams({ client_id: "client-1", resource: "https://other.test/mcp" }) }), env, oauth, ["flows:read", "runs:read"]);
    await expect(badResource.json()).resolves.toMatchObject({ error: "invalid_target" });
  });

  it("returns authorization_pending and slow_down while approval is outstanding", async () => {
    const kv = new MemoryKv(), env = environment(kv);
    const issue = await deviceAuthorization(new Request("https://factorize.test/oauth/device_authorization", { method: "POST", body: new URLSearchParams({ client_id: "client-1", scope: "runs:read" }) }), env, { lookupClient: vi.fn().mockResolvedValue(publicClient), completeAuthorization: vi.fn() }, ["flows:read", "runs:read"]);
    const { device_code } = await issue.json() as any;
    const poll = () => deviceToken(new Request("https://factorize.test/oauth/token", { method: "POST", body: new URLSearchParams({ grant_type: DEVICE_GRANT, client_id: "client-1", device_code }) }), env, { fetch: vi.fn() }, {} as ExecutionContext);
    await expect((await poll()).json()).resolves.toMatchObject({ error: "authorization_pending" });
    await expect((await poll()).json()).resolves.toMatchObject({ error: "slow_down" });
  });

  it("approves a code and exchanges it through the normal PKCE token endpoint", async () => {
    const kv = new MemoryKv(), env = environment(kv);
    const completeAuthorization = vi.fn(async ({ request }: any) => ({ redirectTo: `${request.redirectUri}?code=authorization-code` }));
    const oauth = { lookupClient: vi.fn().mockResolvedValue(publicClient), completeAuthorization };
    const issue = await deviceAuthorization(new Request("https://factorize.test/oauth/device_authorization", { method: "POST", body: new URLSearchParams({ client_id: "client-1", scope: "runs:read" }) }), env, oauth, ["flows:read", "runs:read"]);
    const issued = await issue.json() as any;
    const approved = await deviceVerification(new Request("https://factorize.test/device", { method: "POST", body: new URLSearchParams({ user_code: issued.user_code, decision: "allow" }) }), env, oauth, { tenantId: "tenant-1", userId: "owner-1", email: "owner@example.com", sessionVersion: 3 });
    expect(approved.status).toBe(200);
    expect(completeAuthorization).toHaveBeenCalledWith(expect.objectContaining({ scope: ["runs:read"], revokeExistingGrants: false }));
    const providerFetch = vi.fn(async (request: Request) => {
      const body = await request.formData();
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code")).toBe("authorization-code");
      expect(body.get("code_verifier")).toBeTruthy();
      return Response.json({ access_token: "access", token_type: "bearer", expires_in: 3600 });
    });
    const token = await deviceToken(new Request("https://factorize.test/oauth/token", { method: "POST", body: new URLSearchParams({ grant_type: DEVICE_GRANT, client_id: "client-1", device_code: issued.device_code }) }), env, { fetch: providerFetch }, {} as ExecutionContext);
    await expect(token.json()).resolves.toMatchObject({ access_token: "access" });
    expect(providerFetch).toHaveBeenCalledOnce();
  });

  it("advertises the device endpoint and grant", async () => {
    const response = await addDeviceMetadata(Response.json({ grant_types_supported: ["authorization_code", "refresh_token"] }), "https://factorize.test");
    await expect(response.json()).resolves.toMatchObject({ device_authorization_endpoint: "https://factorize.test/oauth/device_authorization", grant_types_supported: ["authorization_code", "refresh_token", DEVICE_GRANT] });
  });

  it("adapts dynamic registration for device-only clients", async () => {
    const env = environment(new MemoryKv());
    const providerFetch = vi.fn(async (request: Request) => {
      const body = await request.json() as any;
      expect(body.grant_types).toEqual(["authorization_code"]);
      expect(body.response_types).toEqual(["code"]);
      expect(body.redirect_uris).toEqual(["https://factorize.test/oauth/device/callback"]);
      return Response.json({ client_id: "registered", grant_types: body.grant_types, response_types: body.response_types, redirect_uris: body.redirect_uris }, { status: 201 });
    });
    const response = await deviceClientRegistration(new Request("https://factorize.test/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grant_types: [DEVICE_GRANT], token_endpoint_auth_method: "none" }) }), env, { fetch: providerFetch }, {} as ExecutionContext);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ client_id: "registered", grant_types: [DEVICE_GRANT], response_types: [], redirect_uris: [] });
  });
});
