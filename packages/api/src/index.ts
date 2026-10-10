import { executeAuth } from "./auth-api";
import { STATIC_CSP, staticApp } from "./static-app";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { readSession, signSession, type Session } from "./session";
export { readSession, signSession, requestCookie, type Session } from "./session";
import { equalHmac, hmac } from "./crypto";
import { createAppJwt, githubHeaders, readSetupState, signSetupState } from "./github";
import type { Env } from "./types";
import { databaseFor } from "./postgres/database";
import { AuthRepository } from "./postgres/auth-repository";
import { IdentityRepository } from "./postgres/identity-repository";
import { ConnectionRepository } from "./postgres/connection-repository";
import { GitHubRepository } from "./postgres/github-repository";
import { WebhookService } from "./postgres/webhook-service";

const app = new Hono<{ Bindings: Env; Variables: { authorizationDuration: number } }>();

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

app.onError((error, c) => {
  console.error(JSON.stringify({ event: "factorize_unexpected_failure", path: c.req.path, message: error.message, factorizeTailSuppressed: c.req.path.startsWith("/webhooks/cloudflare/") }));
  if (c.req.path.startsWith("/api/v1/")) return c.json({ error: { code: "internal_error", message: "Factorize could not complete this request. Try again shortly." } }, 502);
  return c.text("Internal Server Error", 500);
});

async function authed(c: any): Promise<Session | null> { return readSession(getCookie(c, "factorize_session"), c.env.SESSION_SIGNING_SECRET); }
async function owner(c: any): Promise<Session | null> {
  const started = performance.now();
  try {
    const session = await authed(c); if (!session) return null;
    const member = await new IdentityRepository(databaseFor(c.env), session.tenantId).member(session.userId);
    return member?.role === "owner" && member.sessionVersion === session.sessionVersion ? session : null;
  } finally { c.set("authorizationDuration", (c.get("authorizationDuration") ?? 0) + performance.now() - started); }
}

app.get("/healthz", (c) => c.json({ ok: true }));

app.get("/auth/linear", async (c) => {
  const session = await owner(c); if (!session) return c.redirect("/auth/login");
  const state = await signSetupState({ tenantId: session.tenantId, userId: session.userId, nonce: crypto.randomUUID(), exp: Math.floor(Date.now() / 1000) + 600 }, c.env.SESSION_SIGNING_SECRET);
  setCookie(c, "linear_oauth_state", state, { httpOnly: true, secure: new URL(c.env.APP_ORIGIN).protocol === "https:", sameSite: "Lax", path: "/auth/linear", maxAge: 600 });
  const redirect = new URL("https://linear.app/oauth/authorize");
  redirect.searchParams.set("client_id", c.env.LINEAR_CLIENT_ID);
  redirect.searchParams.set("redirect_uri", `${c.env.APP_ORIGIN}/auth/linear/callback`);
  redirect.searchParams.set("response_type", "code");
  redirect.searchParams.set("scope", c.env.LINEAR_OAUTH_SCOPES ?? "read,write");
  redirect.searchParams.set("state", state);
  return c.redirect(redirect.toString());
});

app.get("/auth/linear/callback", async (c) => {
  const session = await owner(c), code = c.req.query("code"), rawState = c.req.query("state");
  const state = rawState ? await readSetupState(rawState, c.env.SESSION_SIGNING_SECRET) : null;
  if (!session || !code || !state || rawState !== getCookie(c, "linear_oauth_state") || state.tenantId !== session.tenantId || state.userId !== session.userId) return c.text("Invalid OAuth state", 400);
  deleteCookie(c, "linear_oauth_state", { path: "/auth/linear" });
  const tokenResponse = await fetch("https://api.linear.app/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, redirect_uri: `${c.env.APP_ORIGIN}/auth/linear/callback`, client_id: c.env.LINEAR_CLIENT_ID, client_secret: c.env.LINEAR_CLIENT_SECRET, grant_type: "authorization_code" }) });
  const tokens = await tokenResponse.json() as { access_token?: string; refresh_token?: string };
  if (!tokenResponse.ok || !tokens.access_token || !tokens.refresh_token) return c.text("Linear token exchange failed", 502);
  const meResponse = await fetch("https://api.linear.app/graphql", { method: "POST", headers: { Authorization: `Bearer ${tokens.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: "query { viewer { id email } organization { id name } }" }) });
  const me = await meResponse.json() as any;
  const organization = me.data?.organization;
  const viewer = me.data?.viewer;
  if (!organization?.id || !viewer?.id) return c.text("Could not identify Linear workspace", 502);
  const connected = await new ConnectionRepository(databaseFor(c.env), session.tenantId, c.env.CREDENTIAL_ENCRYPTION_KEY).putLinear(organization.id, { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, organizationId: organization.id, organizationName: organization.name, viewerId: viewer.id, viewerEmail: viewer.email });
  if (!connected) return c.text("This Linear workspace is already connected to another Factorize workspace. Sign in to that Factorize account to manage it.", 409);
  return c.redirect("/settings/integrations");
});

app.post("/auth/logout", async (c) => {
  const session = await owner(c);
  if (session) await new IdentityRepository(databaseFor(c.env), session.tenantId).revoke(session.userId);
  deleteCookie(c, "factorize_session", { path: "/" });
  return c.redirect("/");
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

app.get("/auth/clickup", async (c) => {
  const session = await owner(c); if (!session) return c.redirect("/auth/login");
  if (!c.env.CLICKUP_CLIENT_ID) return c.text("ClickUp OAuth is not configured", 503);
  const state = await signSession({ ...session, exp: Math.floor(Date.now() / 1000) + 600 }, c.env.SESSION_SIGNING_SECRET);
  setCookie(c, "clickup_oauth_state", state, { httpOnly: true, secure: new URL(c.env.APP_ORIGIN).protocol === "https:", sameSite: "Lax", path: "/auth/clickup", maxAge: 600 });
  const redirect = new URL("https://app.clickup.com/api");
  redirect.searchParams.set("client_id", c.env.CLICKUP_CLIENT_ID);
  redirect.searchParams.set("redirect_uri", `${c.env.APP_ORIGIN}/auth/clickup/callback`);
  redirect.searchParams.set("state", state);
  return c.redirect(redirect.toString());
});

app.get("/auth/clickup/callback", async (c) => {
  const session = await owner(c), code = c.req.query("code"), state = c.req.query("state");
  if (!session || !code || !state || state !== getCookie(c, "clickup_oauth_state") || !c.env.CLICKUP_CLIENT_ID || !c.env.CLICKUP_CLIENT_SECRET) return c.text("Invalid ClickUp OAuth state", 400);
  const tokenResponse = await fetch("https://api.clickup.com/api/v2/oauth/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: c.env.CLICKUP_CLIENT_ID, client_secret: c.env.CLICKUP_CLIENT_SECRET, code }) });
  const tokens = await tokenResponse.json() as { access_token?: string };
  if (!tokenResponse.ok || !tokens.access_token) return c.text("ClickUp token exchange failed", 502);
  const teamsResponse = await fetch("https://api.clickup.com/api/v2/team", { headers: { Authorization: tokens.access_token } });
  const teams = await teamsResponse.json() as any, team = teams.teams?.[0];
  if (!teamsResponse.ok || !team?.id) return c.text("Could not identify a ClickUp workspace", 502);
  const hookResponse = await fetch(`https://api.clickup.com/api/v2/team/${encodeURIComponent(team.id)}/webhook`, { method: "POST", headers: { Authorization: tokens.access_token, "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: `${c.env.APP_ORIGIN}/webhooks/clickup/${encodeURIComponent(session.tenantId)}`, events: ["taskCreated", "taskUpdated", "taskStatusUpdated", "taskAssigneeUpdated", "taskTagUpdated", "taskMoved"] }) });
  const hook = await hookResponse.json() as any;
  if (!hookResponse.ok || !hook.id) return c.text("Could not register the ClickUp webhook", 502);
  await new ConnectionRepository(databaseFor(c.env), session.tenantId, c.env.CREDENTIAL_ENCRYPTION_KEY).put("clickup", { accessToken: tokens.access_token, teamId: String(team.id), teamName: team.name, webhookId: String(hook.id), webhookSecret: hook.secret });
  deleteCookie(c, "clickup_oauth_state", { path: "/auth/clickup" });
  return c.redirect("/settings/integrations");
});

app.get("/auth/github/install", async (c) => {
  const session = await owner(c); if (!session) return c.redirect("/auth/login");
  if (!c.env.GITHUB_APP_SLUG) return c.text("GitHub App is not configured", 503);
  const nonce = crypto.randomUUID();
  const state = await signSetupState({ tenantId: session.tenantId, userId: session.userId, nonce, exp: Math.floor(Date.now() / 1000) + 600 }, c.env.SESSION_SIGNING_SECRET);
  await new GitHubRepository(databaseFor(c.env), session.tenantId).saveSetupState(nonce, Math.floor(Date.now() / 1000) + 600);
  return c.redirect(`https://github.com/apps/${encodeURIComponent(c.env.GITHUB_APP_SLUG)}/installations/new?state=${encodeURIComponent(state)}`);
});
app.get("/auth/github/setup", async (c) => {
  const session = await owner(c); if (!session) return c.text("Unauthorized", 401);
  const state = await readSetupState(c.req.query("state") ?? "", c.env.SESSION_SIGNING_SECRET);
  const installationId = Number(c.req.query("installation_id"));
  if (!state || state.tenantId !== session.tenantId || state.userId !== session.userId || !Number.isSafeInteger(installationId)) return c.text("Invalid or expired setup state", 400);
  if (!await new GitHubRepository(databaseFor(c.env), session.tenantId).consumeSetupState(state.nonce)) return c.text("Setup state was already used", 400);
  if (!c.env.GITHUB_APP_ID || !c.env.GITHUB_APP_PRIVATE_KEY) return c.text("GitHub App is not configured", 503);
  const jwt = await createAppJwt(c.env.GITHUB_APP_ID, c.env.GITHUB_APP_PRIVATE_KEY.replaceAll("\\n", "\n"));
  const gh = await fetch(`https://api.github.com/app/installations/${installationId}`, { headers: githubHeaders(jwt) });
  const installation = await gh.json() as any;
  if (!gh.ok || installation.id !== installationId) return c.text("Could not verify GitHub installation", 502);
  try { await new GitHubRepository(databaseFor(c.env), session.tenantId).save({ installationId, accountLogin: installation.account?.login, accountType: installation.account?.type, state: installation.suspended_at ? "suspended" : "active" }); }
  catch (error) { if (error instanceof Error && error.message === "installation_conflict") return c.text("This GitHub installation is already connected to another tenant", 409); throw error; }
  return c.redirect("/settings");
});
app.post("/webhooks/cloudflare/:tenantId/:jobId", async (c) => {
  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).byteLength > 262_144) return c.text("Payload too large", 413);
  try { await new WebhookService(databaseFor(c.env), c.env, c.req.param("tenantId")).tail(c.req.param("jobId"), raw, c.req.raw.headers); return c.body(null, 202); }
  catch (error) { return c.text(error instanceof Error && error.message === "not_found" ? "Not found" : "Invalid signature", error instanceof Error && error.message === "not_found" ? 404 : 401); }
});

app.post("/webhooks/linear", async (c) => {
  if (!c.env.LINEAR_WEBHOOK_SIGNING_SECRET) return c.text("Webhook verification is not configured", 503);
  const raw = await c.req.text();
  if (!(await equalHmac(raw, c.req.header("linear-signature") ?? "", c.env.LINEAR_WEBHOOK_SIGNING_SECRET))) return c.text("Invalid signature", 401);
  let event: Record<string, unknown>;
  try { event = JSON.parse(raw) as Record<string, unknown>; } catch { return c.text("Invalid JSON", 400); }
  const timestamp = Number(event.webhookTimestamp ?? c.req.header("linear-timestamp"));
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 60_000) return c.text("Stale webhook", 401);
  const organizationId = event.organizationId;
  if (typeof organizationId !== "string" || !organizationId) return c.text("Missing organization ID", 400);
  const deliveryId = c.req.header("linear-delivery");
  if (!deliveryId) return c.text("Missing delivery ID", 400);
  const binding = (await databaseFor(c.env).pool.query<{ tenant_id: string }>("SELECT w.tenant_id FROM app.linear_workspaces w JOIN app.connections c ON c.tenant_id=w.tenant_id AND c.kind='linear' WHERE w.organization_id=$1", [organizationId])).rows[0];
  if (binding) await new WebhookService(databaseFor(c.env), c.env, binding.tenant_id).linear(event, `linear:${deliveryId}`);
  return c.body(null, 200);
});

app.post("/webhooks/clickup/:tenantId", async (c) => {
  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).byteLength > 262_144) return c.text("Payload too large", 413);
  try { JSON.parse(raw); } catch { return c.text("Invalid JSON", 400); }
  try { await new WebhookService(databaseFor(c.env), c.env, c.req.param("tenantId")).clickup(raw, c.req.header("X-Signature") ?? ""); return c.body(null, 200); } catch { return c.text("Invalid signature", 401); }
});

app.post("/webhooks/github", async (c) => {
  if (!c.env.GITHUB_WEBHOOK_SECRET) return c.text("Webhook verification is not configured", 503);
  const raw = await c.req.text();
  const signature = c.req.header("X-Hub-Signature-256") ?? "";
  if (!signature.startsWith("sha256=") || !(await equalHmac(raw, signature.slice(7), c.env.GITHUB_WEBHOOK_SECRET))) return c.text("Invalid signature", 401);
  const delivery = c.req.header("X-GitHub-Delivery"), eventName = c.req.header("X-GitHub-Event");
  if (!delivery || !eventName) return c.text("Missing GitHub headers", 400);
  let event: any; try { event = JSON.parse(raw); } catch { return c.text("Invalid JSON", 400); }
  const installationId = event.installation?.id;
  if (!Number.isSafeInteger(installationId)) return c.text("Missing installation ID", 400);
  const registration = await GitHubRepository.locate(databaseFor(c.env), installationId);
  if (!registration) { console.info(JSON.stringify({ event: "github_webhook_unrouted", installationId, delivery, eventName })); return c.body(null, 202); }
  if (eventName === "installation" && ["deleted", "suspend", "unsuspend"].includes(event.action)) {
    const state: "active" | "suspended" = event.action === "unsuspend" ? "active" : "suspended";
    const repository = new GitHubRepository(databaseFor(c.env), registration.tenant_id);
    if (event.action === "deleted") await repository.delete(installationId); else await repository.updateState(installationId, state);
    return c.body(null, 202);
  }
  if (registration.state !== "active") return c.body(null, 202);
  await new WebhookService(databaseFor(c.env), c.env, registration.tenant_id).github(event, `github:${delivery}`, eventName); return c.body(null, 202);
});

// Only explicit application reads receive the static entry point. Callback and
// protocol routes registered above keep their existing ownership.
app.get("*", async c => await staticApp(c.req.raw, c.env) ?? c.notFound());

export default app;
