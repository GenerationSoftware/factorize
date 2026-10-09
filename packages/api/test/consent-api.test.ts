import { describe, expect, it, vi } from "vitest";
import { consentPreview, consentDecision } from "../src/consent-api";
import { decideDevice, deviceAuthorization, inspectDevice } from "../src/device-oauth";
import type { Env } from "../src/types";
const session = { tenantId: "tenant", userId: "owner", email: "owner@example.test", sessionVersion: 2, exp: Math.floor(Date.now() / 1000) + 3600 };
const parsed = { responseType: "code", clientId: "client", redirectUri: "https://client.test/callback", scope: ["flows:read", "runs:write"], state: "state", codeChallenge: "challenge", codeChallengeMethod: "S256", resource: "https://factorize.test/mcp", issuer: "https://factorize.test" };
function fixture() {
  const values = new Map<string, string>();
  const oauth = { parseAuthRequest: vi.fn(async () => parsed), lookupClient: vi.fn(async () => ({ clientId: "client", clientName: "External client", redirectUris: [parsed.redirectUri], tokenEndpointAuthMethod: "none" })), completeAuthorization: vi.fn(async (_options: unknown) => ({ redirectTo: parsed.redirectUri + "?code=authorized&state=state" })) };
  const env = { APP_ORIGIN: "https://factorize.test", SESSION_SIGNING_SECRET: "test-signing", OAUTH_PROVIDER: oauth, OAUTH_KV: { get: async (key: string, type?: string) => { const value = values.get(key); return value ? type === "json" ? JSON.parse(value) : value : null; }, put: async (key: string, value: string) => { values.set(key, value); }, delete: async (key: string) => { values.delete(key); } } } as unknown as Env;
  return { env, oauth };
}
describe("static consent support", () => {
  it("binds expiring decisions to owner, tenant and session version; enforces requested scopes and current registered redirects", async () => {
    const { env, oauth } = fixture(), preview = (await consentPreview(env, session, { authorizationQuery: "client_id=client&redirect_uri=https%3A%2F%2Fclient.test%2Fcallback" }))!;
    expect(preview.clientName).toBe("External client");
    const input = { request: preview.request, signature: preview.signature, decision: "allow" as const, scopes: ["flows:read" as const] };
    for (const modified of [{ ...session, tenantId: "other" }, { ...session, userId: "other" }, { ...session, sessionVersion: 3 }]) expect(await consentDecision(env, modified, input)).toBeNull();
    expect(await consentDecision(env, session, { ...input, scopes: ["flows:write"] })).toBeNull();
    expect(await consentDecision(env, session, { ...input, request: input.request + "x" })).toBeNull();
    expect(oauth.completeAuthorization).not.toHaveBeenCalled();
    expect((await consentDecision(env, session, input))?.redirectTo).toContain("code=authorized");
    expect(oauth.completeAuthorization.mock.calls[0][0]).toMatchObject({ scope: ["flows:read"], props: { tenantId: session.tenantId, userId: session.userId, sessionVersion: 2, scopes: ["flows:read"] } });
    oauth.lookupClient.mockResolvedValue({ clientId: "client", clientName: "External client", redirectUris: ["https://other.test/callback"], tokenEndpointAuthMethod: "none" });
    expect(await consentDecision(env, session, input)).toBeNull();
  });
  it("expires consent bindings and preserves state and issuer on denial", async () => {
    const { env } = fixture();
    vi.useFakeTimers();
    try { const preview = (await consentPreview(env, session, { authorizationQuery: "client_id=client" }))!;
      const input = { request: preview.request, signature: preview.signature, decision: "deny" as const, scopes: [] };
      const redirect = new URL((await consentDecision(env, session, input))!.redirectTo); expect(redirect.searchParams.get("state")).toBe("state"); expect(redirect.searchParams.get("iss")).toBe(env.APP_ORIGIN); expect(redirect.searchParams.get("error")).toBe("access_denied");
      vi.advanceTimersByTime(601_000); expect(await consentDecision(env, session, input)).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it("inspects only public device metadata and keeps grant/code state server-owned", async () => {
    const { env, oauth } = fixture(), form = new FormData(); form.set("client_id", "client"); form.set("scope", "flows:read");
    const issued = await (await deviceAuthorization(new Request(env.APP_ORIGIN + "/oauth/device_authorization", { method: "POST", body: form }), env, oauth as any, ["flows:read"])).json() as any;
    const info = await inspectDevice(env, issued.user_code); expect(info).toMatchObject({ clientName: "External client", scopes: ["flows:read"] }); expect(info).not.toHaveProperty("device_code");
    expect(await decideDevice(env, oauth as any, session, issued.user_code, "allow")).toEqual({ status: "approved" }); expect(await inspectDevice(env, issued.user_code)).toBeNull(); expect(await decideDevice(env, oauth as any, session, issued.user_code, "allow")).toBeNull(); expect(oauth.completeAuthorization).toHaveBeenCalledTimes(1);
  });
});
