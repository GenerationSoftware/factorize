import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import Ajv2020 from "ajv/dist/2020";
import worker from "../src/worker";
import { protectedApiFetch } from "../src/protected-api";
import { safeReturnTo } from "../src/auth-api";
import { signSession } from "../src/session";
import { AuthRepository } from "../src/postgres/auth-repository";
import { IdentityRepository } from "../src/postgres/identity-repository";
import { ApiService } from "../src/flow-service";
import type { Env, OAuthProps } from "../src/types";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({
  OAuthProvider: class { fetch() { throw new Error("Unexpected OAuth protocol dispatch"); } },
  AuthorizationError: class extends Error {},
  getOAuthApi: vi.fn(),
}));
const env = { APP_ORIGIN: "https://app.test", SESSION_SIGNING_SECRET: "test-only-secret", DATABASE: { pool: { query: vi.fn() } } } as unknown as Env;
const ctx = {} as ExecutionContext;
const identity = { tenantId: "tenant-a", userId: "user-a", email: "owner@test.com", sessionVersion: 4 };
const member = { ...identity, role: "owner" as const };
const auth: OAuthProps = { ...identity, scopes: ["flows:read", "flows:write", "runs:read", "runs:write"], authMethod: "session" };
const openapi = parse(readFileSync(new URL("../../docs/openapi.yaml", import.meta.url), "utf8"));
afterEach(() => vi.restoreAllMocks());

async function call(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return worker.fetch(new Request(env.APP_ORIGIN + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Origin: env.APP_ORIGIN, "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env, ctx);
}
async function contract(response: Response, path: string, method: string) {
  const op = openapi.paths[path][method.toLowerCase()];
  const entry = op.responses[response.status];
  expect(entry).toBeDefined();
  const schema = (entry.$ref ? openapi.components.responses[entry.$ref.split("/").at(-1)] : entry).content["application/json"].schema;
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const validate = ajv.compile({ components: openapi.components, ...schema });
  const body = await response.json();
  expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
  return body;
}

it("publishes the deployment contract marker on the public session read", async () => {
  const response = await protectedApiFetch(new Request("https://factorize.test/api/v1/session"), { APP_ORIGIN: "https://factorize.test" } as Env, null, {} as ExecutionContext);
  expect(response.headers.get("X-Factorize-Contract")).toBe("gen-2157-static-v1");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ authenticated: false });
});

describe("public auth API and cookie security", () => {
  it("returns a documented unauthenticated session without backend data access", async () => {
    const response = await call("/api/v1/session");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await contract(response, "/api/v1/session", "GET")).toEqual({ authenticated: false });
  });

  it("keeps protected application operations authenticated and rejects undeclared public operations", async () => {
    expect((await call("/api/v1/jobs")).status).toBe(401);
    expect((await call("/api/v1/auth/not-declared", {})).status).toBe(401);
    expect((await call("/api/v1/auth/login")).status).toBe(401);
  });

  it.each(["https://evil.test", "null", ""])("rejects public login and logout from origin %s before repository access", async origin => {
    const login = vi.spyOn(AuthRepository.prototype, "login");
    for (const path of ["/api/v1/auth/login", "/api/v1/auth/logout"]) {
      const response = await call(path, { email: "owner@test.com", password: "long-test-password" }, { Origin: origin });
      expect(response.status).toBe(403);
      expect(response.headers.get("Set-Cookie")).toBeNull();
      expect(await contract(response, path, "POST")).toMatchObject({ error: { code: "invalid_origin" } });
    }
    expect(login).not.toHaveBeenCalled();
  });

  it("rejects cross-site requests even with a matching Origin", async () => {
    expect((await call("/api/v1/auth/logout", {}, { "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
  });

  it("keeps malformed protected path encoding inside the JSON error boundary", async () => {
    const cookie = await signSession({ ...identity, exp: Math.floor(Date.now() / 1000) + 100 }, env.SESSION_SIGNING_SECRET);
    const response = await call("/api/v1/jobs/%ZZ", undefined, { Cookie: "factorize_session=" + cookie });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_request" } });
  });

  it("validates public bodies, JSON and content type before repository access", async () => {
    const login = vi.spyOn(AuthRepository.prototype, "login");
    for (const body of [{}, { email: "not-email", password: "short" }, { email: "owner@test.com", password: "long-test-password", tenantId: "other" }])
      expect((await call("/api/v1/auth/login", body)).status).toBe(400);
    for (const [raw, media, status] of [["{", "application/json", 400], ["{}", "text/plain", 415]] as const) {
      const response = await worker.fetch(new Request(env.APP_ORIGIN + "/api/v1/auth/login", { method: "POST", headers: { Origin: env.APP_ORIGIN, "Content-Type": media }, body: raw }), env, ctx);
      expect(response.status).toBe(status);
      await contract(response, "/api/v1/auth/login", "POST");
    }
    expect(login).not.toHaveBeenCalled();
  });

  it("creates an HttpOnly Secure Lax cookie, returns a safe destination and never exposes signing/session data", async () => {
    vi.spyOn(AuthRepository.prototype, "login").mockResolvedValue({ status: 200, body: identity });
    vi.spyOn(IdentityRepository.prototype, "member").mockResolvedValue(member);
    const response = await call("/api/v1/auth/login", { email: "owner@test.com", password: "long-test-password", returnTo: "https://evil.test/" });
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toMatch(/factorize_session=.*HttpOnly/);
    expect(response.headers.get("Set-Cookie")).toContain("Secure");
    expect(response.headers.get("Set-Cookie")).toContain("SameSite=Lax");
    expect(await contract(response, "/api/v1/auth/login", "POST")).toEqual({ ok: true, returnTo: "/settings/integrations" });
  });

  it("rechecks owner membership and session version when establishing a session", async () => {
    vi.spyOn(AuthRepository.prototype, "login").mockResolvedValue({ status: 200, body: identity });
    vi.spyOn(IdentityRepository.prototype, "member").mockResolvedValue({ ...member, sessionVersion: 5 });
    const response = await call("/api/v1/auth/login", { email: "owner@test.com", password: "long-test-password" });
    expect(response.status).toBe(403);
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("maps current authoritative identity and selected workspace without secrets", async () => {
    const cookie = await signSession({ ...identity, email: "stale@test.com", exp: Math.floor(Date.now() / 1000) + 100 }, env.SESSION_SIGNING_SECRET);
    vi.spyOn(IdentityRepository.prototype, "member").mockResolvedValue(member);
    vi.mocked(env.DATABASE!.pool.query).mockResolvedValue({ rows: [{ name: "Workspace A" }] } as never);
    const response = await call("/api/v1/session", undefined, { Cookie: "factorize_session=" + cookie });
    expect(await contract(response, "/api/v1/session", "GET")).toMatchObject({ authenticated: true, user: { id: identity.userId, email: identity.email }, workspace: { id: identity.tenantId, name: "Workspace A", role: "owner" } });
    const query = vi.mocked(env.DATABASE!.pool.query).mock.calls.at(-1)!;
    expect(query[1]).toEqual([identity.tenantId]);
  });

  it.each([null, { ...member, role: "member" as const }, { ...member, sessionVersion: 5 }])("treats revoked, removed and non-owner sessions as unauthenticated", async current => {
    vi.spyOn(IdentityRepository.prototype, "member").mockResolvedValue(current);
    const cookie = await signSession({ ...identity, exp: Math.floor(Date.now() / 1000) + 100 }, env.SESSION_SIGNING_SECRET);
    expect(await (await call("/api/v1/session", undefined, { Cookie: "factorize_session=" + cookie })).json()).toEqual({ authenticated: false });
  });

  it("does not enumerate signup accounts", async () => {
    const signup = vi.spyOn(AuthRepository.prototype, "signup");
    for (const result of [{ status: 201, body: { ok: true } }, { status: 409, body: { error: "Existing email" } }]) {
      signup.mockResolvedValue(result);
      const response = await call("/api/v1/auth/signup", { email: "owner@test.com", password: "long-test-password" });
      expect(response.status).toBe(202);
      expect(await contract(response, "/api/v1/auth/signup", "POST")).toEqual({ ok: true });
    }
  });

  it("preserves non-enumerating requests and one-time verification/reset operations", async () => {
    const verify = vi.spyOn(AuthRepository.prototype, "completeVerification").mockResolvedValue({ status: 200, body: { ok: true } });
    const reset = vi.spyOn(AuthRepository.prototype, "completeReset").mockResolvedValue({ status: 200, body: { ok: true } });
    const email = vi.spyOn(AuthRepository.prototype, "requestEmail").mockResolvedValue({ status: 200, body: { ok: true } });
    for (const [path, body] of [
      ["/api/v1/auth/email-verification/request", { email: "owner@test.com" }],
      ["/api/v1/auth/password-reset/request", { email: "owner@test.com" }],
      ["/api/v1/auth/email-verification/complete", { token: "one-time-token" }],
      ["/api/v1/auth/password-reset/complete", { token: "one-time-token", password: "long-test-password" }],
    ] as const) {
      const response = await call(path, body);
      expect(response.status).toBe(200);
      expect(await contract(response, path, "POST")).toEqual({ ok: true });
    }
    expect(email).toHaveBeenCalledWith({ email: "owner@test.com" }, "verify");
    expect(verify).toHaveBeenCalledWith("one-time-token");
    expect(reset).toHaveBeenCalledWith({ token: "one-time-token", password: "long-test-password" });
  });

  it("requires a valid owner session to change passwords and clears cookies only on success", async () => {
    const change = vi.spyOn(AuthRepository.prototype, "changePassword").mockResolvedValue({ status: 200, body: { ok: true } });
    const body = { currentPassword: "old-test-password", password: "new-test-password" };
    expect((await call("/api/v1/auth/password", body)).status).toBe(401);
    expect(change).not.toHaveBeenCalled();
    vi.spyOn(IdentityRepository.prototype, "member").mockResolvedValue(member);
    const cookie = await signSession({ ...identity, exp: Math.floor(Date.now() / 1000) + 100 }, env.SESSION_SIGNING_SECRET);
    const response = await call("/api/v1/auth/password", body, { Cookie: "factorize_session=" + cookie });
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(change).toHaveBeenCalledWith(identity.userId, body);
  });

  it("revokes logout sessions and safely clears absent/expired sessions too", async () => {
    vi.spyOn(IdentityRepository.prototype, "member").mockResolvedValue(member);
    const revoke = vi.spyOn(IdentityRepository.prototype, "revoke").mockResolvedValue(true);
    const cookie = await signSession({ ...identity, exp: Math.floor(Date.now() / 1000) + 100 }, env.SESSION_SIGNING_SECRET);
    const response = await call("/api/v1/auth/logout", {}, { Cookie: "factorize_session=" + cookie });
    expect(response.status).toBe(200);
    expect(revoke).toHaveBeenCalledWith(identity.userId);
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect((await call("/api/v1/auth/logout", {})).status).toBe(200);
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it("rejects bearer credentials for browser identity and auth operations", async () => {
    for (const [path, body] of [["/api/v1/session", undefined], ["/api/v1/auth/logout", {}]] as const)
      expect((await call(path, body, { Authorization: "Bearer external-token" })).status).toBe(403);
  });

  it("enforces origin for cookie application mutations while preserving bearer clients", async () => {
    const create = vi.spyOn(ApiService.prototype, "createJob").mockResolvedValue({ id: "job" } as never);
    const request = () => new Request(env.APP_ORIGIN + "/api/v1/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Job", slug: "job", promptTemplate: "Do work", executionTargetId: "exe-1" }) });
    expect((await protectedApiFetch(request(), env, auth, ctx)).status).toBe(403);
    expect(create).not.toHaveBeenCalled();
    expect((await protectedApiFetch(request(), env, { ...auth, authMethod: "access_token" }, ctx)).status).toBe(201);
  });
});

describe("safe interrupted-flow navigation", () => {
  it.each(["//evil.test", "https://evil.test", "/\\evil.test", "/device-evil", "/auth/logout", "/jobs\nLocation:evil", "/%2f%2fevil.test"])("rejects %s", value => expect(safeReturnTo(value)).toBe("/settings/integrations"));
  it.each(["/authorize?client_id=a&state=b", "/device?user_code=ABCD-EFGH", "/jobs/job-a/edit", "/job-runs/run-a"])("preserves %s", value => expect(safeReturnTo(value)).toBe(value));
});

describe("cookie-only consent and device API boundaries", () => {
  const requests = [
    ["/api/v1/oauth/consent/preview", { authorizationQuery: "client_id=client" }],
    ["/api/v1/oauth/consent/decision", { request: "request", signature: "signature", decision: "allow", scopes: [] }],
    ["/api/v1/oauth/device/preview", { userCode: "ABCD-EFGH" }],
    ["/api/v1/oauth/device/decision", { userCode: "ABCD-EFGH", decision: "allow" }],
  ] as const;
  it("requires an authoritative owner session and never accepts bearer credentials", async () => {
    for (const [path, body] of requests) {
      expect((await call(path, body)).status).toBe(401);
      expect((await call(path, body, { Authorization: "Bearer external" })).status).toBe(403);
    }
  });
  it("enforces exact Origin and cross-site protection on previews and decisions", async () => {
    for (const [path, body] of requests) for (const headers of [{ Origin: "https://evil.test" }, { "Sec-Fetch-Site": "cross-site" }] as Record<string, string>[]) {
      const response = await call(path, body, headers); expect(response.status).toBe(403); expect(await contract(response, path, "POST")).toMatchObject({ error: { code: "invalid_origin" } });
    }
  });
});
