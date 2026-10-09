import { describe, expect, it } from "vitest";
import app from "../src/index";
import type { Env } from "../src/types";

const env = { APP_ORIGIN: "https://factorize.test", SESSION_SIGNING_SECRET: "test-secret", ASSETS: { fetch: async () => new Response("entry", { headers: { "Content-Type": "text/html" } }) } } as unknown as Env;

describe("browser auth form origin protection", () => {
  it("serves native auth deep links from static assets without embedding one-time tokens", async () => {
    const response = await app.request(`${env.APP_ORIGIN}/auth/password-reset?token=reset-token`, {}, env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html");
    expect(response.headers.get("Cache-Control")).toBe("no-cache, must-revalidate");
    expect(await response.text()).toBe("entry");
  });

  it("keeps same-origin form origins while suppressing external referrers", async () => {
    const page = await app.request(`${env.APP_ORIGIN}/auth/login`, {}, env);
    expect(page.status).toBe(200);
    expect(page.headers.get("Referrer-Policy")).toBe("same-origin");
  });

  it("accepts a same-origin logout POST and clears the cookie", async () => {
    const response = await app.request(`${env.APP_ORIGIN}/auth/logout`, {
      method: "POST", headers: { Origin: env.APP_ORIGIN, "Sec-Fetch-Site": "same-origin" },
    }, env);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/");
    expect(response.headers.get("Set-Cookie")).toContain("factorize_session=; Max-Age=0; Path=/");
  });

  it.each([
    { Origin: "https://evil.test", "Sec-Fetch-Site": "cross-site" },
    { Origin: "https://evil.factorize.test", "Sec-Fetch-Site": "same-site" },
    { Origin: "null", "Sec-Fetch-Site": "same-origin" },
    { "Sec-Fetch-Site": "same-origin" },
    { Origin: env.APP_ORIGIN, "Sec-Fetch-Site": "cross-site" },
  ] as Record<string, string>[])("rejects unsafe logout origins: %j", async (headers) => {
    const response = await app.request(`${env.APP_ORIGIN}/auth/logout`, { method: "POST", headers }, env);
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Invalid request origin");
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("does not log out through a GET request", async () => {
    const response = await app.request(`${env.APP_ORIGIN}/auth/logout`, {}, env);
    expect(response.status).toBe(404);
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });
});
