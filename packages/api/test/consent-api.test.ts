import { describe, expect, it, vi } from "vitest";
import { consentPreview, consentDecision } from "../src/consent-api";
import { decideDevice, deviceAuthorization, inspectDevice } from "../src/device-oauth";
import type { Env } from "../src/types";
import type { Connection } from "../src/oauth-continuation";
import { tokenDigest } from "../src/auth";
import { connectionCookie } from "../src/oauth-continuation";
const installation = vi.hoisted(() => ({
  getLegacyOAuthChoices: vi.fn(), getOAuthInstallation: vi.fn(), listOAuthInstallations: vi.fn(),
  materializeLegacyOAuthInstallation: vi.fn(), prepareOAuthIssuance: vi.fn(),
}));
vi.mock("../src/oauth-installations", () => installation);

const session = { tenantId: "tenant", userId: "owner", email: "owner@example.test", sessionVersion: 2, exp: Math.floor(Date.now() / 1000) + 3600 };
const parsed = { responseType: "code", clientId: "client", redirectUri: "https://client.test/callback", scope: ["team:read", "triggers:read", "integrations:read", "triggers:read", "triggers:write", "triggers:write", "triggers:write"], state: "state", codeChallenge: "challenge", codeChallengeMethod: "S256", resource: "https://factorize.test/mcp", issuer: "https://factorize.test" };
const queryWithScope = { authorizationQuery: "client_id=client&scope=fixture" };
const deniedId = "18a2410e-ea09-4fe0-af8a-719c0c91e6e2";
const integrationScope = `integration:${deniedId}:1`;
function fixture(defaultScopes?: string[], reconnect?: { approved: string[]; saved: string[]; denied?: boolean; revision?: number }) {
  const values = new Map<string, string>();
  let connection: Connection | null = null;
  const used = new Set<string>();
  const query = vi.fn(async (sql: string, args: unknown[]) => {
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.includes("FROM app.agent_identities")) return { rows: reconnect ? [{
      subject: "previous-grant", scope_overrides: reconnect.saved, disabled_scopes: [], integration_overrides: reconnect.denied ? { [deniedId]: false } : {}, revoked_at: null, permissions_revision: reconnect.revision ?? 1,
    }] : [] };
    if (sql.includes("FROM app.agent_integrations")) return { rows: [{ id: deniedId, epoch: 1, available: true, policy: "baseline", name: "Fixture integration", description: null }] };
    if (sql.includes("FROM app.oauth_connections")) return { rows: connection && !connection.used_at ? [connection] : [] };
    if (sql.startsWith("UPDATE app.oauth_connections SET user_id=")) {
      if (connection) connection.user_id = String(args[1]);
      return { rows: [] };
    }
    if (sql.startsWith("UPDATE app.oauth_connections SET used_at=")) {
      if (!connection || connection.used_at) return { rows: [] };
      connection.used_at = new Date();
      return { rows: [{ id: connection.id }] };
    }
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
  const legacyRow = () => ({ id: "installation-id", user_id: session.userId, tenant_id: session.tenantId,
    client_id: parsed.clientId, redirect_uri: parsed.redirectUri, policy_revision: reconnect?.revision ?? 1,
    selected_scopes: (reconnect?.saved ?? []).filter(scope => !reconnect?.denied || scope !== integrationScope),
    active_scopes: reconnect?.approved ?? [], created_at: new Date(), display_name: "Laptop", revoked_at: null });
  installation.listOAuthInstallations.mockReset().mockResolvedValue([]);
  installation.getOAuthInstallation.mockReset().mockImplementation(async (_db, _tenant, _user, id) => id === "installation-id" && reconnect ? legacyRow() : null);
  installation.getLegacyOAuthChoices.mockReset().mockImplementation(async () => {
    const page = await oauth.listUserGrants();
    return page.items.filter(item => item.redirectUri === parsed.redirectUri).map(item => ({
      grantId: item.id, displayName: "Laptop", createdAt: item.createdAt, selectedScopes: legacyRow().selected_scopes,
      activeScopes: item.scope, policyRevision: legacyRow().policy_revision,
    }));
  });
  installation.materializeLegacyOAuthInstallation.mockReset().mockImplementation(async () => legacyRow());
  installation.prepareOAuthIssuance.mockReset().mockImplementation(async (_db, input) => ({
    installationId: input.installationId ?? "new-installation", issuanceId: "pending-issuance",
  }));
  const env = { DATABASE: { pool: { query }, transaction: async (work: any) => work({ query }) }, APP_ORIGIN: "https://factorize.test", SESSION_SIGNING_SECRET: "test-signing", OAUTH_PROVIDER: oauth, OAUTH_KV: { get: async (key: string, type?: string) => { const value = values.get(key); return value ? type === "json" ? JSON.parse(value) : value : null; }, put: async (key: string, value: string) => { values.set(key, value); }, delete: async (key: string) => { values.delete(key); } } } as unknown as Env;
  return { env, oauth, setConnection: (value: Connection) => { connection = value; } };
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

  const explicit = { ...queryWithScope, target: { kind: "legacy" as const, id: "previous-grant" } };
  const consentBrowsers = new WeakMap<object, Request>();
  async function reconnectPreview(f: ReturnType<typeof fixture>, input: typeof queryWithScope & { target: {kind: "installation" | "legacy"; id: string} }) {
    const id = crypto.randomUUID();
    const cookie = "fixture-browser";
    f.setConnection({ id, browser_digest: await tokenDigest(cookie, f.env.SESSION_SIGNING_SECRET), destination: "/authorize?" + input.authorizationQuery,
      client_name: "External client", kind: "callback", expires_at: new Date(Date.now()+120_000), user_id: null, ready: true, ready_version: null, used_at: null });
    const browser = new Request(f.env.APP_ORIGIN + "/authorize", { headers: { Cookie: connectionCookie(id) + "=" + cookie } });
    const preview = await consentPreview(f.env, session, { ...input, authorizationQuery: input.authorizationQuery + "&connection=" + id }, browser);
    consentBrowsers.set(preview, browser);
    return preview;
  }
  const approve = (env: Env, preview: Awaited<ReturnType<typeof consentPreview>>, scopes = preview.selectedScopes) =>
    consentDecision(env, session, { request: preview.request, signature: preview.signature, decision: "allow", scopes }, consentBrowsers.get(preview));

  it("offers compatible alternatives but defaults to a separate connection even if exactly one matches", async () => {
    const { env, oauth } = fixture(["integrations:read"], { approved: ["team:read"], saved: ["team:read", "triggers:write"] });
    const fresh = await consentPreview(env, session, queryWithScope);
    expect(fresh).toMatchObject({ reconnect: false, selectedScopes: ["integrations:read"],
      targets: [{ kind: "legacy", id: "previous-grant", name: "Laptop" }] });
    expect(await approve(env, fresh)).toMatchObject({ redirectTo: expect.stringContaining("code=authorized") });
    expect(installation.materializeLegacyOAuthInstallation).not.toHaveBeenCalled();
    expect(installation.prepareOAuthIssuance.mock.calls[0][1]).toMatchObject({ installationId: null, selectedScopes: ["integrations:read"] });
    expect(oauth.completeAuthorization).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ oauthInstallationId: "new-installation" }) }));
  });

  it("stages reconnect of only the selected installation, with identical displayed and issued scopes", async () => {
    const saved = { approved: ["team:read"], saved: ["team:read", "triggers:write"] };
    const f = fixture(["integrations:read"], saved);
    const { env, oauth } = f;
    await expect(consentPreview(env, session, explicit)).rejects.toThrow("before choosing an existing connection");
    const preview = await reconnectPreview(f, explicit);
    expect(preview).toMatchObject({ reconnect: true, selectedScopes: ["team:read", "triggers:write"], unavailableSavedScopes: [] });
    expect(await approve(env, preview)).toMatchObject({ redirectTo: expect.stringContaining("code=authorized") });
    expect(installation.materializeLegacyOAuthInstallation.mock.calls[0].slice(2)).toEqual([session, "previous-grant", parsed.clientId, parsed.redirectUri]);
    expect(installation.prepareOAuthIssuance.mock.calls[0][1]).toMatchObject({ installationId: "installation-id", policyRevision: 1, selectedScopes: preview.selectedScopes, credentialScopes: preview.selectedScopes });
    expect(oauth.completeAuthorization).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      scope: preview.selectedScopes, props: expect.objectContaining({ scopes: preview.selectedScopes, oauthInstallationId: "installation-id", oauthIssuanceId: "pending-issuance" }), revokeExistingGrants: false,
    }));
    expect(saved.approved).toEqual(["team:read"]);
  });

  it("offers available saved permissions on an explicitly selected, scope-limited reconnect", async () => {
    const f = fixture(undefined, { approved: ["team:read"], saved: ["team:read", "triggers:write"] });
    const { env, oauth } = f;
    oauth.parseAuthRequest.mockResolvedValue({ ...parsed, scope: ["team:read"] });
    const limited = await reconnectPreview(f, explicit);
    expect(limited).toMatchObject({ scopes: ["team:read", "triggers:write"], selectedScopes: ["team:read", "triggers:write"], savedOutsideRequestedScopes: ["triggers:write"], unavailableSavedScopes: [] });
    expect(await approve(env, limited)).toMatchObject({ redirectTo: expect.any(String) });
    expect(installation.prepareOAuthIssuance.mock.calls[0][1]).toMatchObject({
      selectedScopes: ["team:read", "triggers:write"], credentialScopes: ["team:read", "triggers:write"],
    });
    oauth.parseAuthRequest.mockResolvedValue({ ...parsed, scope: [] });
    const omitted = await reconnectPreview(f, { ...explicit, authorizationQuery: "client_id=client" });
    expect(omitted.selectedScopes).toEqual(["team:read", "triggers:write"]);
    expect(omitted.newScopes).toEqual([]);
  });

  it("binds an explicit stable target and refuses an edited or incompatible selection", async () => {
    const saved = { approved: ["proxy:use", integrationScope], saved: ["proxy:use", integrationScope], denied: true, revision: 1 };
    const f = fixture(undefined, saved);
    const { env, oauth } = f;
    oauth.parseAuthRequest.mockResolvedValue({ ...parsed, scope: ["proxy:use", integrationScope] });
    installation.listOAuthInstallations.mockResolvedValue([await installation.getOAuthInstallation(null, null, null, "installation-id")]);
    const requested = { ...queryWithScope, target: { kind: "installation" as const, id: "installation-id" } };
    const initial = await reconnectPreview(f, requested);
    expect(initial).toMatchObject({ selectedScopes: ["proxy:use"], blockedScopes: [integrationScope] });
    saved.revision++;
    expect(await approve(env, initial)).toBeNull();
    expect(oauth.completeAuthorization).not.toHaveBeenCalled();
    await expect(reconnectPreview(f, { ...requested, target: { ...requested.target, id: "another-installation" } })).rejects.toThrow("not available");
    installation.listOAuthInstallations.mockResolvedValue([await installation.getOAuthInstallation(null, null, null, "installation-id")]);
    const reviewed = await reconnectPreview(f, requested);
    expect(await approve(env, reviewed)).toMatchObject({ redirectTo: expect.any(String) });
    expect(installation.prepareOAuthIssuance.mock.calls[0][1]).toMatchObject({ installationId: "installation-id", policyRevision: 2,
      selectedScopes: ["proxy:use"], credentialScopes: ["proxy:use"] });
  });

  it("requires the original continuation browser at both preview and approval", async () => {
    const { env, oauth, setConnection } = fixture(["team:read"]);
    const id = "ab57c1b7-bdeb-45ae-a933-45686266070f";
    const cookie = "fixture-browser";
    setConnection({ id, browser_digest: await tokenDigest(cookie, env.SESSION_SIGNING_SECRET), destination: "/authorize?" + queryWithScope.authorizationQuery,
      client_name: "External client", kind: "callback", expires_at: new Date(Date.now()+120_000), user_id: null, ready: true, ready_version: null, used_at: null });
    const browser = new Request(env.APP_ORIGIN + "/authorize", { headers: { Cookie: connectionCookie(id) + "=" + cookie } });
    const other = new Request(env.APP_ORIGIN + "/authorize");
    const query = { authorizationQuery: queryWithScope.authorizationQuery + "&connection=" + id };
    await expect(consentPreview(env, session, query, other)).rejects.toThrow("where you started connecting");
    const preview = await consentPreview(env, session, query, browser);
    const approval = { request: preview.request, signature: preview.signature, decision: "allow" as const, scopes: preview.selectedScopes };
    expect(await consentDecision(env, session, approval, other)).toBeNull();
    expect(oauth.completeAuthorization).not.toHaveBeenCalled();
    expect(await consentDecision(env, session, approval, browser)).toMatchObject({ redirectTo: expect.any(String) });
    expect(await consentDecision(env, session, approval, browser)).toBeNull();
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
