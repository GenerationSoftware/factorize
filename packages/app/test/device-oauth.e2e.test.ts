import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { DEVICE_GRANT } from "../src/device-oauth";
import { signSession } from "../src/index";
import type { Env as FactorizeEnv } from "../src/types";

declare module "cloudflare:test" {
  interface ProvidedEnv extends FactorizeEnv {}
}

const origin = "https://app.factorize.sh";

describe("OAuth device flow", () => {
  it("completes registration, login return, approval, and token exchange through the Worker", async () => {
    const tenantId = "device-e2e-tenant";
    const userId = "device-e2e-owner";
    const tenant = env.TENANTS.get(env.TENANTS.idFromName(`tenant:${tenantId}`));
    const memberResponse = await tenant.fetch("https://tenant/members", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, email: "owner@example.com" }),
    });
    expect(memberResponse.status).toBe(200);

    const registrationResponse = await SELF.fetch(`${origin}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Device E2E",
        grant_types: [DEVICE_GRANT],
        response_types: [],
        redirect_uris: [],
        token_endpoint_auth_method: "none",
      }),
    });
    expect(registrationResponse.status).toBe(201);
    const registration = await registrationResponse.json<{ client_id: string }>();

    const authorizationResponse = await SELF.fetch(`${origin}/oauth/device_authorization`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: registration.client_id,
        scope: "runs:read flows:read",
        resource: `${origin}/mcp`,
      }),
    });
    expect(authorizationResponse.status).toBe(200);
    const authorization = await authorizationResponse.json<{ device_code: string; user_code: string; verification_uri_complete: string }>();

    const loginRedirect = await SELF.fetch(authorization.verification_uri_complete, { redirect: "manual" });
    expect(loginRedirect.status).toBe(302);
    expect(loginRedirect.headers.get("location")).toBe(`${origin}/auth/linear`);
    expect(loginRedirect.headers.get("set-cookie")).toContain(`factorize_oauth_return=%2Fdevice%3Fuser_code%3D${encodeURIComponent(authorization.user_code)}`);

    const session = await signSession({
      tenantId,
      userId,
      email: "owner@example.com",
      exp: Math.floor(Date.now() / 1000) + 60,
      sessionVersion: 1,
    }, "e2e-session-secret");
    const cookie = `factorize_session=${session}`;

    const consentResponse = await SELF.fetch(authorization.verification_uri_complete, { headers: { cookie } });
    expect(consentResponse.status).toBe(200);
    const consent = await consentResponse.text();
    expect(consent).toContain('name="decision" value="allow"');
    expect(consent).toContain(`value="${authorization.user_code}"`);

    const approvalResponse = await SELF.fetch(`${origin}/device`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ user_code: authorization.user_code, decision: "allow" }),
    });
    expect(approvalResponse.status).toBe(200);
    await expect(approvalResponse.text()).resolves.toContain("Device connected");

    const tokenResponse = await SELF.fetch(`${origin}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: DEVICE_GRANT,
        client_id: registration.client_id,
        device_code: authorization.device_code,
      }),
    });
    expect(tokenResponse.status).toBe(200);
    const token = await tokenResponse.json<{ access_token: string; token_type: string; scope?: string }>();
    expect(token.access_token).toBeTruthy();
    expect(token.token_type.toLowerCase()).toBe("bearer");

    const apiResponse = await SELF.fetch(`${origin}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token.access_token}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        host: "app.factorize.sh",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "device-e2e", version: "1.0.0" } } }),
    });
    const apiBody = await apiResponse.text();
    expect(apiResponse.status, apiBody).toBe(200);

    const clientsResponse = await SELF.fetch(`${origin}/api/access/authorized-clients`, { headers: { cookie } });
    expect(clientsResponse.status).toBe(200);
    await expect(clientsResponse.json()).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ clientId: registration.client_id, clientName: "Device E2E", scopes: ["runs:read", "flows:read"] })]));
    expect((await SELF.fetch(`${origin}/api/access/authorized-clients/${encodeURIComponent(registration.client_id)}`, { method: "DELETE", headers: { cookie } })).status).toBe(200);
    expect((await SELF.fetch(`${origin}/api/v1/runs`, { headers: { authorization: `Bearer ${token.access_token}` } })).status).toBe(401);
  });
});

describe("manually issued access tokens", () => {
  it("hashes, scopes, tracks, expires, discloses once, and revokes bearer tokens", async () => {
    const tenantId = "access-token-e2e-tenant", userId = "access-token-e2e-owner";
    const tenant = env.TENANTS.get(env.TENANTS.idFromName(`tenant:${tenantId}`));
    await tenant.fetch("https://tenant/members", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId, email: "owner@example.com" }) });
    const session = await signSession({ tenantId, userId, email: "owner@example.com", exp: Math.floor(Date.now() / 1000) + 60, sessionVersion: 1 }, "e2e-session-secret");
    const cookie = `factorize_session=${session}`;

    const createdResponse = await SELF.fetch(`${origin}/api/access-tokens`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "Read runs", scopes: ["runs:read"], expiryDays: 7 }) });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json<{ id: string; token: string }>();
    expect(created.token).toMatch(/^fzt_/);

    const listedText = await (await SELF.fetch(`${origin}/api/access-tokens`, { headers: { cookie } })).text();
    expect(listedText).not.toContain(created.token);
    expect(listedText).not.toContain("digest");

    const scoped = await SELF.fetch(`${origin}/api/v1/jobs`, { headers: { authorization: `Bearer ${created.token}` } });
    expect(scoped.status).toBe(403);
    const tracked = await (await SELF.fetch(`${origin}/api/access-tokens`, { headers: { cookie } })).json<Array<{ id: string; last_used_at?: string }>>();
    expect(tracked.find(token => token.id === created.id)?.last_used_at).toBeTruthy();

    expect((await SELF.fetch(`${origin}/api/access-tokens/${created.id}`, { method: "DELETE", headers: { cookie } })).status).toBe(200);
    expect((await SELF.fetch(`${origin}/api/v1/runs`, { headers: { authorization: `Bearer ${created.token}` } })).status).toBe(401);

    const expiredRaw = `fzt_${btoa(tenantId).replaceAll("=", "")}_${"a".repeat(43)}`;
    const { accessTokenDigest } = await import("../src/access-tokens");
    await tenant.fetch("https://tenant/access-tokens", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Expired", digest: await accessTokenDigest(expiredRaw), userId, sessionVersion: 1, scopes: ["runs:read"], expiresAt: new Date(Date.now() - 1000).toISOString() }) });
    expect((await SELF.fetch(`${origin}/api/v1/runs`, { headers: { authorization: `Bearer ${expiredRaw}` } })).status).toBe(401);
  });
});
