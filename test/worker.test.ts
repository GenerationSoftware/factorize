import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

import app, { signSession } from "../src/index";
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

  it("returns flow activity through the authenticated Durable Object boundary", async () => {
    const activity = { flow: { id: "flow-1", name: "Bugs" }, events: [], runs: [] };
    const response = await app.request("https://factorize.test/api/pipes/flow-1", {
      headers: { cookie: await sessionCookie() },
    }, testEnv(ownerHandler({ "/pipes/flow-1": Response.json(activity) })));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(activity);
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

  it("forwards flow creation with its JSON body", async () => {
    let forwarded: { method: string; body: unknown } | undefined;
    const env = testEnv(async (request) => {
      const path = new URL(request.url).pathname;
      if (path === "/members/user-1") return Response.json({ role: "owner", session_version: 1 });
      if (path === "/pipes") {
        forwarded = { method: request.method, body: await request.json() };
        return Response.json({ id: "flow-1" }, { status: 201 });
      }
      return new Response("Not found", { status: 404 });
    });
    const flow = { name: "Bugs", projectId: "project-1", filterType: "label", filterTargetId: "label-1", maxConcurrency: 3 };
    const response = await app.request("https://factorize.test/api/pipes", {
      method: "POST",
      headers: { cookie: await sessionCookie(), "content-type": "application/json" },
      body: JSON.stringify(flow),
    }, env);
    expect(response.status).toBe(201);
    expect(forwarded).toEqual({ method: "POST", body: flow });
  });

  it("forwards flow edits through the authenticated Durable Object boundary", async () => {
    let forwarded: { method: string; body: unknown } | undefined;
    const env = testEnv(async (request) => {
      const path = new URL(request.url).pathname;
      if (path === "/members/user-1") return Response.json({ role: "owner", session_version: 1 });
      if (path === "/pipes/flow-1") { forwarded = { method: request.method, body: await request.json() }; return Response.json({ ok: true }); }
      return new Response("Not found", { status: 404 });
    });
    const flow = { name: "Bugs", projectId: "project-1", filterType: "label", filterTargetId: "label-1", workspaceName: "bugs", maxConcurrency: 3 };
    const response = await app.request("https://factorize.test/api/pipes/flow-1", { method: "PUT", headers: { cookie: await sessionCookie(), "content-type": "application/json" }, body: JSON.stringify(flow) }, env);
    expect(response.status).toBe(200);
    expect(forwarded).toEqual({ method: "PUT", body: flow });
  });

  it("serves an authenticated flow edit page", async () => {
    const response = await app.request("https://factorize.test/flows/flow-1/edit", {
      headers: { cookie: await sessionCookie() },
    }, testEnv(ownerHandler({})));
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("Edit flow");
  });

  it("forwards flow deletion and clears the session on logout", async () => {
    let deleted = false;
    const env = testEnv(ownerHandler({ "/pipes/flow-1": () => { deleted = true; return Response.json({ ok: true }); } }));
    const response = await app.request("https://factorize.test/api/pipes/flow-1", {
      method: "DELETE", headers: { cookie: await sessionCookie() },
    }, env);
    expect(response.status).toBe(200);
    expect(deleted).toBe(true);

    const logout = await app.request("https://factorize.test/auth/logout", { method: "POST", headers: { cookie: await sessionCookie() } }, env);
    expect(logout.status).toBe(302);
    expect(logout.headers.get("set-cookie")).toContain("factorize_session=");
    expect(logout.headers.get("location")).toBe("/");
  });
});
