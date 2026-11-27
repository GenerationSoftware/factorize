import { describe, expect, it } from "vitest";
import app from "../src/index";
import type { Env } from "../src/config/bindings";

const env = {
  APP_ORIGIN: "https://factorize.test",
  SESSION_SIGNING_SECRET: "browser-router-test",
  LINEAR_WEBHOOK_SIGNING_SECRET: "linear-test",
  GITHUB_WEBHOOK_SECRET: "github-test",
  ASSETS: { fetch: async () => new Response("static shell", { headers: { "Content-Type": "text/html" } }) },
} as unknown as Env;

describe("browser router capability mounts", () => {
  it.each(["/auth/linear", "/auth/clickup", "/auth/github/install"])("keeps provider setup behind browser sign-in: %s", async path => {
    const response = await app.request(env.APP_ORIGIN + path, {}, env);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/auth/login");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it.each([
    ["/webhooks/linear", 401],
    ["/webhooks/clickup/test-tenant", 400],
    ["/webhooks/github", 401],
    ["/webhooks/cloudflare/test-tenant/test-trigger", 410],
  ])("dispatches ingress independently of static assets: %s", async (path, status) => {
    const response = await app.request(env.APP_ORIGIN + path, { method: "POST", body: "invalid" }, env);
    expect(response.status).toBe(status);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.text()).not.toBe("static shell");
  });
});
