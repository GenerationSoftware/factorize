import { deleteCookie } from "hono/cookie";
import { executeAuth } from "../api/auth-api";
import { browserOwner as owner } from "./browser-owner";
import { AuthRepository } from "../storage/auth-repository";
import { databaseFor } from "../../postgres/database";
import type { BrowserRouter } from "../../runtime/browser-router";

export function mountBrowserForms(app: BrowserRouter) {
  app.post("/auth/logout", async (c) => {
    const response = await executeAuth("logout", c.req.raw, c.env);
    if (!response.ok) return response;
    const headers = new Headers(response.headers);
    headers.set("Location", "/");
    headers.delete("Content-Type");
    return new Response(null, { status: 302, headers });
  });

  // Form compatibility uses the same continuation and session rules as the JSON API.
  async function authForm(c: any, action: "signup" | "login" | "reset-request" | "reset" | "verification" | "verification-request") {
    const response = await executeAuth(action, c.req.raw, c.env, await c.req.parseBody());
    const body = await response.json() as any;
    if (!response.ok) return c.text(body.error?.message ?? "The request could not be completed.", response.status);
    const headers = new Headers(response.headers);
    headers.set("Content-Type", "text/plain; charset=utf-8");
    if (body.returnTo) { headers.set("Location", body.returnTo); return new Response(null, { status: 303, headers }); }
    return new Response(body.crossBrowser ? "Email verified. Return to the original browser to finish connecting your MCP client." : "Check your email for the next step.", { status: action === "signup" ? 201 : 200, headers });
  }
  app.post("/auth/signup", c => authForm(c, "signup"));
  app.post("/auth/login", c => authForm(c, "login"));
  app.post("/auth/password-reset", c => authForm(c, "reset-request"));
  app.post("/auth/password-reset/complete", c => authForm(c, "reset"));
  app.post("/auth/verify", c => authForm(c, "verification"));
  app.post("/auth/verify/request", c => authForm(c, "verification-request"));
  app.post("/auth/password-change", async (c) => {
    const session = await owner(c); if (!session) return c.text("Unauthorized", 401);
    const result = await new AuthRepository(databaseFor(c.env), c.env).changePassword(session.userId, await c.req.parseBody());
    if (result.status !== 200) return c.text("The request could not be completed. Return to the sign-in page and try again.", result.status as any);
    deleteCookie(c, "factorize_session", { path: "/" });
    return c.redirect("/auth/login", 303);
  });
}
