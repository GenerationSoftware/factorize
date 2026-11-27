import { Hono } from "hono";
import { staticApp, STATIC_CSP } from "./runtime/static-app";
import type { BrowserRouter } from "./runtime/browser-router";
import { mountBrowserForms } from "./auth/transport/browser-forms";
import { mountLinearOAuthRoutes } from "./integrations/providers/linear-oauth-routes";
import { mountClickupOAuthRoutes } from "./integrations/providers/clickup-oauth-routes";
import { mountGithubOAuthRoutes } from "./integrations/providers/github-oauth-routes";
import { mountWebhookIngress } from "./triggers/api/webhook-ingress";

const app: BrowserRouter = new Hono();

app.use("*", async (c, next) => {
  const started = performance.now();
  c.set("authorizationDuration", 0);
  await next();
  const authorizationDuration = c.get("authorizationDuration");
  c.header("Server-Timing", `auth;dur=${authorizationDuration.toFixed(1)}, application;dur=${Math.max(0, performance.now() - started - authorizationDuration).toFixed(1)}`);
  c.header("Content-Security-Policy", STATIC_CSP);
  // Keep Origin on same-origin form POSTs; no-referrer makes it "null" in
  // browsers and breaks the auth CSRF check. External requests still omit Referer.
  c.header("Referrer-Policy", "same-origin");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (new URL(c.req.url).protocol === "https:") c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
});

app.use("/auth/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  if (c.req.method === "POST" && (c.req.header("Origin") !== c.env.APP_ORIGIN || c.req.header("Sec-Fetch-Site") === "cross-site")) return c.text("Invalid request origin", 403);
  await next();
});

app.onError((_error, c) => {
  console.error(JSON.stringify({ event: "factorize_unexpected_failure", factorizeTailSuppressed: c.req.path.startsWith("/webhooks/cloudflare/") }));
  if (c.req.path.startsWith("/api/v1/")) return c.json({ error: { code: "internal_error", message: "Factorize could not complete this request. Try again shortly." } }, 502);
  return c.text("Internal Server Error", 500);
});

app.get("/healthz", (c) => c.json({ ok: true }));
mountLinearOAuthRoutes(app);
mountBrowserForms(app);
mountClickupOAuthRoutes(app);
mountGithubOAuthRoutes(app);
mountWebhookIngress(app);

// Only explicit application reads receive the static entry point. Callback and
// protocol routes registered above keep their existing ownership.
app.get("*", async c => await staticApp(c.req.raw, c.env) ?? c.notFound());

export default app;
