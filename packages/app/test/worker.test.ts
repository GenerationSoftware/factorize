import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

import app, { requestCookie, signSession } from "../src/index";
import type { Env } from "../src/types";

type StubHandler = (request: Request) => Response | Promise<Response>;

function testEnv(handler: StubHandler): Env {
  const id = Object.create(null) as DurableObjectId;
  const stub = Object.assign(Object.create(null), {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => handler(new Request(input, init)),
  }) as DurableObjectStub;
  const namespace = Object.assign(Object.create(null), {
    idFromName: () => id,
    get: () => stub,
  }) as DurableObjectNamespace;
  const assets = Object.assign(Object.create(null), {
    fetch: async () => new Response("not found", { status: 404 }),
  }) as Fetcher;
  return {
    TENANTS: namespace,
    ASSETS: assets,
    APP_ORIGIN: "https://factorize.test",
    LINEAR_CLIENT_ID: "linear-client",
    LINEAR_CLIENT_SECRET: "linear-secret",
    LINEAR_WEBHOOK_SIGNING_SECRET: "webhook-secret",
    CREDENTIAL_ENCRYPTION_KEY: "unused-in-route-tests",
    SESSION_SIGNING_SECRET: "session-secret",
  };
}

async function sessionCookie(): Promise<string> {
  const value = await signSession({
    tenantId: "workspace-1",
    userId: "user-1",
    email: "owner@example.com",
    exp: Math.floor(Date.now() / 1000) + 60,
    sessionVersion: 1,
  }, "session-secret");
  return `factorize_session=${value}`;
}

function ownerHandler(routes: Record<string, Response | (() => Response)>): StubHandler {
  return (request) => {
    const path = new URL(request.url).pathname;
    if (path === "/members/user-1") return Response.json({ role: "owner", session_version: 1 });
    const response = routes[path];
    return typeof response === "function" ? response() : response ?? new Response("Not found", { status: 404 });
  };
}

describe("Worker routes", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("decodes URL-encoded session cookies in OAuth routes", async () => {
    const session = await signSession({ tenantId: "workspace-1", userId: "user-1", email: "owner@example.com", exp: Math.floor(Date.now() / 1000) + 60, sessionVersion: 1 }, "session-secret");
    const request = new Request("https://factorize.test/device", { headers: { cookie: `factorize_session=${encodeURIComponent(session)}` } });
    expect(requestCookie(request, "factorize_session")).toBe(session);
  });

  it("serves the landing page with nonce-protected scripts", async () => {
    const response = await app.request("https://factorize.test/", {}, testEnv(() => new Response("Not found", { status: 404 })));
    const html = await response.text();
    const nonce = response.headers.get("content-security-policy")?.match(/nonce-([^']+)/)?.[1];
    expect(response.status).toBe(200);
    expect(nonce).toBeTruthy();
    expect(html.match(new RegExp(`<script nonce="${nonce}">`, "g"))).toHaveLength(2);
    expect(html).not.toContain("<script>");
  });

  it("rejects projects without an authenticated owner", async () => {
    const response = await app.request("https://factorize.test/api/linear/projects", {}, testEnv(() => new Response("Not found")));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns projects through the authenticated Durable Object boundary", async () => {
    const projects = [{ id: "project-1", name: "Factorize" }];
    const response = await app.request("https://factorize.test/api/linear/projects", {
      headers: { cookie: await sessionCookie() },
    }, testEnv(ownerHandler({ "/linear/projects": Response.json(projects) })));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(projects);
  });

  it("returns secret-free integration status through the owner boundary", async () => {
    const status = {
      linear: { organizationName: "Generation", viewerEmail: "owner@example.com" },
      exeConnections: [{ connectionId: "exe-1", vmName: "exedev@workbox", cwd: "/repo", agentKind: "codex" }],
      ampConnections: [{ connectionId: "amp-1", project: "generation/factorize", apiBaseUrl: "https://ampcode.com/api/cloud/v1" }],
    };
    const response = await app.request("https://factorize.test/api/connections/status", {
      headers: { cookie: await sessionCookie() },
    }, testEnv(ownerHandler({ "/connections/status": Response.json(status) })));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(status);
    expect(JSON.stringify(body)).not.toContain("apiToken");
    expect(JSON.stringify(body)).not.toContain("accessToken");
    expect(JSON.stringify(body)).not.toContain("refreshToken");
  });

  it("fails closed for removed Flow and generic webhook routes", async () => {
    const env = testEnv(ownerHandler({}));
    for (const path of ["/api/pipes", "/api/pipes/old", "/api/runs/old", "/flows", "/flows/old", "/webhooks/custom/tenant/job"]) {
      const response = await app.request(`https://factorize.test${path}`, { headers: { cookie: await sessionCookie() } }, env);
      expect(response.status, path).toBe(404);
    }
  });

  it("preserves a useful upstream GraphQL error instead of turning it into a 500", async () => {
    const response = await app.request("https://factorize.test/api/linear/projects", {
      headers: { cookie: await sessionCookie() },
    }, testEnv(ownerHandler({ "/linear/projects": Response.json({ error: "Query too complex" }, { status: 400 }) })));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Query too complex" });
  });

  it("turns an unexpected binding exception into a JSON 502", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await app.request("https://factorize.test/api/linear/projects", {
      headers: { cookie: await sessionCookie() },
    }, testEnv(() => { throw new Error("binding unavailable"); }));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Factorize could not complete this request. Try again shortly." });
  });

  it("routes signed Cloudflare Tail deliveries without a browser session", async () => {
    let forwarded: Request | undefined;
    const response = await app.request("https://factorize.test/webhooks/cloudflare/tenant-a/flow-a", {
      method: "POST", headers: { "content-type": "application/json", "x-factorize-timestamp": "123", "x-factorize-delivery": "delivery-a", "x-factorize-signature": "sha256=abc" }, body: '{"scriptName":"producer"}',
    }, testEnv(request => { forwarded = request; return new Response(null, { status: 202 }); }));
    expect(response.status).toBe(202);
    expect(new URL(forwarded!.url).pathname).toBe("/webhook/cloudflare/flow-a");
    expect(forwarded!.headers.get("x-factorize-delivery")).toBe("delivery-a");
    await expect(forwarded!.text()).resolves.toBe('{"scriptName":"producer"}');
  });

  it("clears the session on logout", async () => {
    const env = testEnv(ownerHandler({}));
    const logout = await app.request("https://factorize.test/auth/logout", { method: "POST", headers: { cookie: await sessionCookie() } }, env);
    expect(logout.status).toBe(302);
    expect(logout.headers.get("set-cookie")).toContain("factorize_session=");
    expect(logout.headers.get("location")).toBe("/");
  });
});
