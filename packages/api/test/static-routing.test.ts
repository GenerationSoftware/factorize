import { describe, expect, it, vi } from "vitest";
import { isStaticPage, staticApp, STATIC_CSP } from "../src/static-app";
import type { Env } from "../src/types";

describe("same-origin static ownership", () => {
  it("serves explicit deep links with an external-bundle policy and revalidated entry HTML", async () => {
    const fetch = vi.fn(async (request: Request) => new Response(request.method === "HEAD" ? null : "entry", { headers: { "Content-Type": "text/html" } }));
    const env = { ASSETS: { fetch } } as unknown as Env;
    for (const path of ["/", "/jobs", "/jobs/new", "/jobs/id/edit", "/jobs/id/settings", "/job-runs/id", "/settings/authorized-clients", "/auth/verify?token=one-time", "/authorize?client_id=test", "/device?user_code=ABCD-2345"]) {
      const response = await staticApp(new Request(`https://app.factorize.sh${path}`), env);
      expect(response?.status).toBe(200);
      expect(response?.headers.get("content-security-policy")).toBe(STATIC_CSP);
      expect(response?.headers.get("cache-control")).toBe("no-cache, must-revalidate");
      expect(response?.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response?.headers.get("strict-transport-security")).toContain("31536000");
      expect(new URL(fetch.mock.calls.at(-1)![0].url).pathname).toBe("/index.html");
      expect(new URL(fetch.mock.calls.at(-1)![0].url).search).toBe("");
    }
    const head = await staticApp(new Request("https://app.factorize.sh/jobs/id", { method: "HEAD" }), env);
    expect(await head?.text()).toBe("");
  });
  it("never forwards backend namespaces, unknown routes or mutations to static hosting", async () => {
    const fetch = vi.fn(); const env = { ASSETS: { fetch } } as unknown as Env;
    for (const path of ["/api/v1", "/api/v1/unknown", "/api/v1/jobs", "/oauth/token", "/auth/linear", "/auth/github/setup", "/webhooks/github", "/internal/missing", "/mcp", "/healthz", "/.well-known/oauth-authorization-server", "/unknown", "/assets/subdir/file.js", "/index.html", "/jobs/id/edit/extra", "/jobs/id/settings/extra", "/jobs/id/unknown"]) {
      expect(await staticApp(new Request(`https://app.factorize.sh${path}`), env)).toBeNull();
    }
    for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) for (const path of ["/jobs", "/authorize", "/device", "/assets/index-hash.js", "/auth/login"]) expect(await staticApp(new Request(`https://app.factorize.sh${path}`, { method }), env)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(isStaticPage("/settings/unknown")).toBe(false);
  });
  it("caches successful hashed assets immutably but never caches missing chunks", async () => {
    const fetch = vi.fn(async (request: Request) => new Response("asset", { status: request.url.endsWith("missing.js") ? 404 : 200 }));
    const env = { ASSETS: { fetch } } as unknown as Env;
    const asset = await staticApp(new Request("https://app.factorize.sh/assets/index-hash.js"), env);
    expect(asset?.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const missing = await staticApp(new Request("https://app.factorize.sh/assets/missing.js"), env);
    expect(missing?.status).toBe(404); expect(missing?.headers.get("cache-control")).toBe("no-store");
  });
});
