import { describe, expect, it, vi } from "vitest";
import { consentPreview, consentDecision } from "../src/consent-api";
import { decideDevice, deviceAuthorization, inspectDevice } from "../src/device-oauth";
import type { Env } from "../src/types";
const session = { tenantId: "tenant", userId: "owner", email: "owner@example.test", sessionVersion: 2, exp: Math.floor(Date.now() / 1000) + 3600 };
const parsed = { responseType: "code", clientId: "client", redirectUri: "https://client.test/callback", scope: ["team:read", "triggers:read", "integrations:read", "triggers:read", "triggers:write", "triggers:write", "triggers:write"], state: "state", codeChallenge: "challenge", codeChallengeMethod: "S256", resource: "https://factorize.test/mcp", issuer: "https://factorize.test" };
const queryWithScope = { authorizationQuery: "client_id=client&scope=fixture" };
const deniedId = "18a2410e-ea09-4fe0-af8a-719c0c91e6e2";
const integrationScope = `integration:${deniedId}:1`;
function fixture(defaultScopes?: string[], reconnect?: { approved: string[]; saved: string[]; denied?: boolean; revision?: number }) {
  const values = new Map<string, string>();
  const used = new Set<string>();
  const query = vi.fn(async (sql: string, args: unknown[]) => {
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.includes("FROM app.agent_identities")) return { rows: reconnect ? [{
      subject: "previous-grant", scope_overrides: reconnect.saved, disabled_scopes: [], integration_overrides: reconnect.denied ? { [deniedId]: false } : {}, revoked_at: null, permissions_revision: reconnect.revision ?? 1,
    }] : [] };
    if (sql.includes("FROM app.agent_integrations")) return { rows: [{ id: deniedId, epoch: 1, available: true, policy: "baseline", name: "Fixture integration", description: null }] };
    if (sql.includes("FROM app.oauth_connections")) return { rows: [] };
    if (sql.includes("FROM app.team_permission_defaults")) return { rows: (defaultScopes ?? []).map(scope => ({
      permission: scope === integrationScope ? "integration:" + deniedId : scope, enabled: true,
    })) };
    if (sql.startsWith("INSERT INTO app.oauth_consent_previews") ||
        sql.startsWith("DELETE FROM app.oauth_consent_previews")) return { rows: [] };
    if (!sql.startsWith("UPDATE app.oauth_consent_previews")) throw new Error(`Unexpected consent query: ${sql}`);
    const id = String(args[0]);
    if (used.has(id)) return { rows: [] };
    used.add(id);
    return { rows: [{ id }] };
  });
  const oauth = { parseAuthRequest: vi.fn(async () => parsed), listUserGrants: vi.fn(async () => ({ items: reconnect ? [{
    id: "previous-grant", clientId: parsed.clientId, userId: session.userId, metadata: { tenantId: session.tenantId }, redirectUri: parsed.redirectUri, scope: reconnect.approved, createdAt: Math.floor(Date.now() / 1000) - 60,
  }] : [] })), lookupClient: vi.fn(async () => ({ clientId: "client", clientName: "External client", redirectUris: [parsed.redirectUri], tokenEndpointAuthMethod: "none" })), completeAuthorization: vi.fn(async (_options: unknown) => ({ redirectTo: parsed.redirectUri + "?code=authorized&state=state" })) };
  const env = { DATABASE: { pool: { query }, transaction: async (work: any) => work({ query }) }, APP_ORIGIN: "https://factorize.test", SESSION_SIGNING_SECRET: "test-signing", OAUTH_PROVIDER: oauth, OAUTH_KV: { get: async (key: string, type?: string) => { const value = values.get(key); return value ? type === "json" ? JSON.parse(value) : value : null; }, put: async (key: string, value: string) => { values.set(key, value); }, delete: async (key: string) => { values.delete(key); } } } as unknown as Env;
  return { env, oauth };
}
describe("static consent support", () => {
  it("binds expiring decisions to owner, tenant and session version; enforces requested scopes and current registered redirects", async () => {
    const { env, oauth } = fixture(), preview = (await consentPreview(env, session, queryWithScope))!;
    expect(preview.clientName).toBe("External client");
    expect(preview.selectedScopes).toEqual([]);
    const input = { request: preview.request, signature: preview.signature, decision: "allow" as const, scopes: ["team:read", "triggers:read", "integrations:read"] };
    for (const modified of [{ ...session, tenantId: "other" }, { ...session, userId: "other" }, { ...session, sessionVersion: 3 }]) expect(await consentDecision(env, modified, input)).toBeNull();
    expect(await consentDecision(env, session, { ...input, scopes: ["team:write", "triggers:write", "integrations:write"] })).toBeNull();
    expect(await consentDecision(env, session, { ...input, request: input.request + "x" })).toBeNull();
    expect(oauth.completeAuthorization).not.toHaveBeenCalled();
    expect((await consentDecision(env, session, input))?.redirectTo).toContain("code=authorized");
    expect(oauth.completeAuthorization.mock.calls[0][0]).toMatchObject({ scope: ["team:read", "triggers:read", "integrations:read"], props: { tenantId: session.tenantId, userId: session.userId, sessionVersion: 2, scopes: ["team:read", "triggers:read", "integrations:read"] } });
    oauth.lookupClient.mockResolvedValue({ clientId: "client", clientName: "External client", redirectUris: ["https://other.test/callback"], tokenEndpointAuthMethod: "none" });
    expect(await consentDecision(env, session, input)).toBeNull();
  });
  it("issues exactly the team defaults shown as selected", async () => {
    const { env, oauth } = fixture(["team:read"]);
    const preview = (await consentPreview(env, session, queryWithScope))!;
    expect(preview.selectedScopes).toEqual(["team:read"]);
    const input = { request: preview.request, signature: preview.signature, decision: "allow" as const, scopes: preview.selectedScopes };
    expect((await consentDecision(env, session, input))?.redirectTo).toContain("code=authorized");
    expect(oauth.completeAuthorization).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      scope: ["team:read"], props: expect.objectContaining({ scopes: ["team:read"] }),
    }));
  });
  it("expires consent bindings and preserves state and issuer on denial", async () => {
    const { env } = fixture();
    vi.useFakeTimers();
    try { const preview = (await consentPreview(env, session, queryWithScope))!;
      const input = { request: preview.request, signature: preview.signature, decision: "deny" as const, scopes: [] };
      const redirect = new URL((await consentDecision(env, session, input))!.redirectTo); expect(redirect.searchParams.get("state")).toBe("state"); expect(redirect.searchParams.get("iss")).toBe(env.APP_ORIGIN); expect(redirect.searchParams.get("error")).toBe("access_denied");
      vi.advanceTimersByTime(601_000); expect(await consentDecision(env, session, input)).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it("applies integration defaults only inside the requested scope ceiling", async () => {
    const { env, oauth } = fixture(["team:read", integrationScope]);
    oauth.parseAuthRequest.mockResolvedValue({ ...parsed, scope: ["team:read"] });
    const none = await consentPreview(env, session, { authorizationQuery: "client_id=client&scope=" });
    expect(none.scopes).toEqual([]);
    expect(none.selectedScopes).toEqual([]);
    const omitted = await consentPreview(env, session, { authorizationQuery: "client_id=client" });
    expect(omitted.scopes).toContain(integrationScope);
    expect(omitted.selectedScopes).toEqual(["team:read", integrationScope]);
    oauth.parseAuthRequest.mockResolvedValue({ ...parsed, scope: ["team:read"] });
    const limited = await consentPreview(env, session, queryWithScope);
    expect(limited.selectedScopes).toEqual(["team:read"]);
  });

  it("carries forward an earlier baseline grant but does not apply a new team default during step-up", async () => {
    const { env, oauth } = fixture(["team:write"], { approved: ["proxy:use"], saved: ["proxy:use"] });
    oauth.parseAuthRequest.mockResolvedValue({ ...parsed, scope: ["proxy:use", "team:write", integrationScope] });
    const preview = await consentPreview(env, session, queryWithScope);
    expect(preview.selectedScopes).toEqual(["proxy:use", integrationScope]);
    expect(preview.newScopes).toEqual(["team:write"]);
  });

  it("carries saved scope additions into a new owner-approved grant without replacing the old grant", async () => {
    const reconnect = { approved: ["team:read"], saved: ["team:read", "triggers:write"] };
    const { env, oauth } = fixture(["integrations:read"], reconnect);
    const preview = (await consentPreview(env, session, queryWithScope))!;
    expect(preview).toMatchObject({ reconnect: true, selectedScopes: ["team:read", "triggers:write"], unavailableSavedScopes: [] });
    const input = { request: preview.request, signature: preview.signature, decision: "allow" as const, scopes: preview.selectedScopes };
    expect((await consentDecision(env, session, input))?.redirectTo).toContain("code=authorized");
    expect(oauth.completeAuthorization).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      scope: ["team:read", "triggers:write"], props: expect.objectContaining({ scopes: ["team:read", "triggers:write"] }), revokeExistingGrants: false,
    }));
    expect(reconnect.approved).toEqual(["team:read"]);
  });

  it("limits explicit requests and offers owner choices when the client omits scope", async () => {
    const { env, oauth } = fixture(undefined, { approved: ["team:read"], saved: ["team:read", "triggers:write"] });
    oauth.parseAuthRequest.mockResolvedValue({ ...parsed, scope: ["team:read"] });
    const limited = (await consentPreview(env, session, queryWithScope))!;
    expect(limited).toMatchObject({ scopes: ["team:read"], selectedScopes: ["team:read"], unavailableSavedScopes: ["triggers:write"] });
    oauth.parseAuthRequest.mockResolvedValue({ ...parsed, scope: [] });
    const selectable = (await consentPreview(env, session, { authorizationQuery: "client_id=client" }))!;
    expect(selectable.scopes).toEqual(expect.arrayContaining(["team:read", "triggers:read", "triggers:write"]));
    expect(selectable.selectedScopes).toEqual(["team:read", "triggers:write"]);
    expect(selectable.newScopes).toEqual([]);
    expect(selectable.grantedScopes).toEqual(["team:read"]);
    const chosen = ["team:read", "triggers:read", "triggers:write"];
    await consentDecision(env, session, { request: selectable.request, signature: selectable.signature, decision: "allow", scopes: chosen });
    expect(oauth.completeAuthorization).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      request: expect.objectContaining({ scope: [] }), scope: chosen, props: expect.objectContaining({ scopes: chosen }),
    }));
  });

  it("does not import permissions from a different redirect or merge peer grants", async () => {
    const { env, oauth } = fixture(["triggers:write"], { approved: ["team:read"], saved: ["team:read"] });
    const { items: [original] } = await oauth.listUserGrants();
    oauth.listUserGrants.mockResolvedValue({ items: [
      { ...original, id: "wrong-redirect", redirectUri: "https://client.test/other", createdAt: original.createdAt+2, scope: ["triggers:write"] },
      original,
      { ...original, id: "older-copy", createdAt: original.createdAt-1, scope: ["integrations:read"] },
    ] });
    const preview = await consentPreview(env, session, queryWithScope);
    expect(preview.selectedScopes).toEqual(["team:read"]);
    expect(preview.newScopes).toContain("triggers:write");
    expect(preview.grantedScopes).toEqual(["team:read"]);
  });

  it("does not infer legacy baseline scopes when multiple copies match the same redirect", async () => {
    const { env, oauth } = fixture(undefined, { approved: ["proxy:use"], saved: ["proxy:use"] });
    oauth.parseAuthRequest.mockResolvedValue({ ...parsed, scope: ["proxy:use", integrationScope] });
    const before = await consentPreview(env, session, queryWithScope);
    expect(before.selectedScopes).toEqual(["proxy:use", integrationScope]);
    const { items: [original] } = await oauth.listUserGrants();
    oauth.listUserGrants.mockResolvedValue({ items: [
      original, { ...original, id: "older-copy", createdAt: original.createdAt-1 },
    ] });
    expect(await consentDecision(env, session, { request: before.request, signature: before.signature,
      decision: "allow", scopes: before.selectedScopes })).toBeNull();
    const preview = await consentPreview(env, session, queryWithScope);
    expect(preview.selectedScopes).toEqual(["proxy:use"]);
    expect(preview.newScopes).toEqual([integrationScope]);
  });

  it("carries an explicit integration block through reconnect until the owner selects its scope", async () => {
    const { env, oauth } = fixture(undefined, { approved: ["proxy:use", integrationScope], saved: ["proxy:use", integrationScope], denied: true });
    oauth.parseAuthRequest.mockResolvedValue({ ...parsed, scope: ["proxy:use", integrationScope] });
    const unchanged = (await consentPreview(env, session, queryWithScope))!;
    expect(unchanged.scopes).toContain(integrationScope);
    expect(unchanged.selectedScopes).toEqual(["proxy:use"]);
    expect(unchanged.blockedScopes).toEqual([integrationScope]);
    await consentDecision(env, session, { request: unchanged.request, signature: unchanged.signature, decision: "allow", scopes: unchanged.selectedScopes });
    expect(oauth.completeAuthorization).toHaveBeenNthCalledWith(1, expect.objectContaining({
      scope: ["proxy:use"], metadata: { tenantId: session.tenantId, explicitIntegrationScopes: true, initialIntegrationDenials: [deniedId] },
      props: expect.objectContaining({ initialIntegrationDenials: [deniedId] }),
    }));
    const changed = (await consentPreview(env, session, queryWithScope))!;
    await consentDecision(env, session, { request: changed.request, signature: changed.signature, decision: "allow", scopes: changed.scopes });
    expect(oauth.completeAuthorization).toHaveBeenNthCalledWith(2, expect.objectContaining({
      scope: ["proxy:use", integrationScope], metadata: { tenantId: session.tenantId, explicitIntegrationScopes: true },
    }));
  });

  it("records displayed baseline integrations left unchecked as explicit denials", async () => {
    const { env, oauth } = fixture(undefined, { approved: ["proxy:use", integrationScope], saved: ["proxy:use", integrationScope] });
    oauth.parseAuthRequest.mockResolvedValue({ ...parsed, scope: ["proxy:use", integrationScope] });
    const preview = await consentPreview(env, session, queryWithScope);
    expect(preview.selectedScopes).toEqual(["proxy:use", integrationScope]);
    const result = await consentDecision(env, session, { request: preview.request, signature: preview.signature, decision: "allow", scopes: ["proxy:use"] });
    expect(result?.redirectTo).toContain("code=authorized");
    expect(oauth.completeAuthorization).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      scope: ["proxy:use"], props: expect.objectContaining({ initialIntegrationDenials: [deniedId] }),
    }));
  });

  it("requires a fresh consent review after a saved permission edit", async () => {
    const saved = { approved: ["proxy:use", integrationScope], saved: ["proxy:use", integrationScope], denied: true, revision: 1 };
    const { env, oauth } = fixture(undefined, saved);
    oauth.parseAuthRequest.mockResolvedValue({ ...parsed, scope: ["proxy:use", integrationScope] });
    const original = await consentPreview(env, session, queryWithScope);
    saved.revision += 1;
    const refreshed = await consentPreview(env, session, queryWithScope);
    const approve = (preview: typeof original) => consentDecision(env, session, {
      request: preview.request, signature: preview.signature, decision: "allow", scopes: preview.selectedScopes,
    });
    await expect(approve(original)).resolves.toBeNull();
    expect(oauth.completeAuthorization).not.toHaveBeenCalled();
    await expect(approve(refreshed)).resolves.toMatchObject({ redirectTo: expect.stringContaining("code=authorized") });
    expect(oauth.completeAuthorization).toHaveBeenCalledTimes(1);
  });

  it("gives an actionable expired-link response and accepts a fresh authorization", async () => {
    const { env } = fixture();
    await expect(consentPreview(env, session, {
      authorizationQuery: queryWithScope.authorizationQuery + "&connection=ab57c1b7-bdeb-45ae-a933-45686266070f",
    })).rejects.toThrow("Start Reconnect in your MCP client");
    await expect(consentPreview(env, session, queryWithScope)).resolves.toMatchObject({ clientName: "External client" });
  });

  it("inspects only public device metadata and keeps grant/code state server-owned", async () => {
    const { env, oauth } = fixture(); delete env.DATABASE; const form = new FormData(); form.set("client_id", "client"); form.set("scope", "team:read triggers:read integrations:read");
    const issued = await (await deviceAuthorization(new Request(env.APP_ORIGIN + "/oauth/device_authorization", { method: "POST", body: form }), env, oauth as any, ["team:read", "triggers:read", "integrations:read"])).json() as any;
    const info = await inspectDevice(env, issued.user_code); expect(info).toMatchObject({ clientName: "External client", scopes: ["team:read", "triggers:read", "integrations:read"] }); expect(info).not.toHaveProperty("device_code");
    expect(await decideDevice(env, oauth as any, session, issued.user_code, "allow")).toEqual({ status: "approved" }); expect(await inspectDevice(env, issued.user_code)).toBeNull(); expect(await decideDevice(env, oauth as any, session, issued.user_code, "allow")).toBeNull(); expect(oauth.completeAuthorization).toHaveBeenCalledTimes(1);
  });
});
