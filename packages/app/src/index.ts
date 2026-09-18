import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { parse } from "hono/utils/cookie";
import { equalHmac, hmac } from "./crypto";
import { createAppJwt, githubHeaders, readSetupState, signSetupState } from "./github";
import { apiKeysSettingsPage, authPage, jobDetailPage, jobPage, jobsPage, jobRunPage, landingPage, loginPage, settingsPage } from "./ui";
import type { Env } from "./types";
import { databaseFor } from "./postgres/database";
import { AuthRepository } from "./postgres/auth-repository";
import { IdentityRepository } from "./postgres/identity-repository";
import { ConnectionRepository } from "./postgres/connection-repository";
import { GitHubRepository } from "./postgres/github-repository";
import { WebhookService } from "./postgres/webhook-service";

const app = new Hono<{ Bindings: Env; Variables: { cspNonce: string } }>();

app.use("*", async (c, next) => {
  const nonce = crypto.randomUUID();
  c.set("cspNonce", nonce);
  await next();
  c.header("Content-Security-Policy", `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (new URL(c.req.url).protocol === "https:") c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
});

app.onError((error, c) => {
  console.error(JSON.stringify({ event: "factorize_unexpected_failure", path: c.req.path, message: error.message, factorizeTailSuppressed: c.req.path.startsWith("/webhooks/cloudflare/") }));
  if (c.req.path.startsWith("/api/v1/")) return c.json({ error: { code: "internal_error", message: "Factorize could not complete this request. Try again shortly." } }, 502);
  return c.text("Internal Server Error", 500);
});

export type Session = { tenantId: string; userId: string; email: string; exp: number; sessionVersion: number };
const textEncoder = new TextEncoder();

function b64(value: string): string { return btoa(String.fromCharCode(...textEncoder.encode(value))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }
function unb64(value: string): string { const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4); return new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))); }
export async function signSession(session: Session, secret: string): Promise<string> { const body = b64(JSON.stringify(session)); return `${body}.${await hmac(body, secret)}`; }
export async function readSession(value: string | undefined, secret: string): Promise<Session | null> {
  if (!value) return null;
  const [body, signature] = value.split(".");
  if (!body || !signature || signature !== await hmac(body, secret)) return null;
  try { const session = JSON.parse(unb64(body)) as Session; return session.exp > Math.floor(Date.now() / 1000) ? session : null; } catch { return null; }
}
export const requestCookie = (request: Request, name: string) => {
  const header = request.headers.get("Cookie");
  return header ? parse(header, name)[name] : undefined;
};

async function authIdentity(c: any, path: string, input: Record<string, unknown>) {
  const auth = new AuthRepository(databaseFor(c.env), c.env);
  const result = path === "/signup" ? await auth.signup(input) : path === "/login" ? await auth.login(input) : path === "/reset/request" ? await auth.requestReset(input) : await auth.completeReset(input);
  return { response: new Response(JSON.stringify(result.body), { status: result.status, headers: { "Content-Type": "application/json" } }), body: result.body as any };
}
async function establishSession(c: any, identity: { userId: string; email: string; tenantId: string }) {
  const data = await new IdentityRepository(databaseFor(c.env), identity.tenantId).upsertOwner(identity.userId, identity.email);
  if (data.role !== "owner") return false;
  const lifetime = 60 * 60 * 24 * 7;
  setCookie(c, "factorize_session", await signSession({ tenantId: identity.tenantId, userId: identity.userId, email: identity.email, exp: Math.floor(Date.now() / 1000) + lifetime, sessionVersion: data.sessionVersion }, c.env.SESSION_SIGNING_SECRET), { httpOnly: true, secure: new URL(c.env.APP_ORIGIN).protocol === "https:", sameSite: "Lax", path: "/", maxAge: lifetime });
  return true;
}
async function authed(c: any): Promise<Session | null> { return readSession(getCookie(c, "factorize_session"), c.env.SESSION_SIGNING_SECRET); }
async function owner(c: any): Promise<Session | null> {
  const session = await authed(c); if (!session) return null;
  const member = await new IdentityRepository(databaseFor(c.env), session.tenantId).member(session.userId);
  return member?.role === "owner" && member.sessionVersion === session.sessionVersion ? session : null;
}

app.get("/styles.css", (c) => c.env.ASSETS.fetch(c.req.raw));
app.get("/healthz", (c) => c.json({ ok: true }));

app.get("/auth/linear", async (c) => {
  const state = crypto.randomUUID();
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
  const code = c.req.query("code");
  if (!code || c.req.query("state") !== getCookie(c, "linear_oauth_state")) return c.text("Invalid OAuth state", 400);
  const tokenResponse = await fetch("https://api.linear.app/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, redirect_uri: `${c.env.APP_ORIGIN}/auth/linear/callback`, client_id: c.env.LINEAR_CLIENT_ID, client_secret: c.env.LINEAR_CLIENT_SECRET, grant_type: "authorization_code" }) });
  const tokens = await tokenResponse.json() as { access_token?: string; refresh_token?: string };
  if (!tokenResponse.ok || !tokens.access_token || !tokens.refresh_token) return c.text("Linear token exchange failed", 502);
  const meResponse = await fetch("https://api.linear.app/graphql", { method: "POST", headers: { Authorization: `Bearer ${tokens.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: "query { viewer { id email } organization { id name } }" }) });
  const me = await meResponse.json() as any;
  const organization = me.data?.organization;
  const viewer = me.data?.viewer;
  if (!organization?.id || !viewer?.id) return c.text("Could not identify Linear workspace", 502);
  const member = await new IdentityRepository(databaseFor(c.env), organization.id).upsertOwner(viewer.id, viewer.email, organization.name);
  if (member.role !== "owner") return c.text("This Factorize tenant requires an owner invitation.", 403);
  await new ConnectionRepository(databaseFor(c.env), organization.id, c.env.CREDENTIAL_ENCRYPTION_KEY).put("linear", { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, organizationId: organization.id, organizationName: organization.name, viewerId: viewer.id, viewerEmail: viewer.email });
  const lifetime = 60 * 60 * 24 * 7;
  setCookie(c, "factorize_session", await signSession({ tenantId: organization.id, userId: viewer.id, email: viewer.email, exp: Math.floor(Date.now() / 1000) + lifetime, sessionVersion: member.sessionVersion }, c.env.SESSION_SIGNING_SECRET), { httpOnly: true, secure: new URL(c.env.APP_ORIGIN).protocol === "https:", sameSite: "Lax", path: "/", maxAge: lifetime });
  const oauthReturn = getCookie(c, "factorize_oauth_return");
  if (oauthReturn?.startsWith("/authorize?") || oauthReturn?.startsWith("/device")) { deleteCookie(c, "factorize_oauth_return", { path: "/" }); return c.redirect(oauthReturn); }
  return c.redirect("/jobs");
});

app.post("/auth/logout", (c) => {
  deleteCookie(c, "factorize_session", { path: "/" });
  return c.redirect("/");
});

app.post("/auth/signup", async (c) => { const input = await c.req.parseBody(); const result = await authIdentity(c, "/signup", input as Record<string, unknown>); if (!result.response.ok) return c.json(result.body, result.response.status as any); if (!await establishSession(c, result.body)) return c.text("This account cannot access the tenant", 403); return c.redirect("/jobs", 303); });
app.post("/auth/login", async (c) => { const input = await c.req.parseBody(); const result = await authIdentity(c, "/login", input as Record<string, unknown>); if (!result.response.ok) return c.html(render(authPage("Sign in", "login", String(input.email ?? ""), result.body.error), c.get("cspNonce")), result.response.status as any); if (!await establishSession(c, result.body)) return c.text("This account cannot access the tenant", 403); return c.redirect("/jobs", 303); });
app.post("/auth/password-reset", async (c) => { const input = await c.req.parseBody(); const result = await authIdentity(c, "/reset/request", input as Record<string, unknown>); return c.html(render(authPage("Check your email", "reset", "", result.body.error), c.get("cspNonce")), result.response.status as any); });
app.post("/auth/password-reset/complete", async (c) => { const input = await c.req.parseBody(); const result = await authIdentity(c, "/reset/complete", input as Record<string, unknown>); return result.response.ok ? c.redirect("/auth/login", 303) : c.html(render(authPage("Reset password", "complete", String(input.token ?? ""), result.body.error), c.get("cspNonce")), result.response.status as any); });

app.get("/auth/clickup", async (c) => {
  const session = await owner(c); if (!session) return c.redirect("/auth/linear");
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
  const session = await owner(c); if (!session) return c.redirect("/auth/linear");
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
  await new WebhookService(databaseFor(c.env), c.env, organizationId).linear(event, `linear:${deliveryId}`); return c.body(null, 200);
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

const render = (page: string, nonce: string) => page.replaceAll("<script>", `<script nonce="${nonce}">`);

app.get("/", async (c) => {
  const session = await owner(c);
  return session ? c.redirect("/jobs") : c.html(render(loginPage(c.env.MARKETING_ORIGIN), c.get("cspNonce")));
});
app.get("/auth/signup", (c) => c.html(render(authPage("Create your Factorize account", "signup"), c.get("cspNonce"))));
app.get("/auth/login", (c) => c.html(render(authPage("Sign in to Factorize", "login"), c.get("cspNonce"))));
app.get("/auth/password-reset", (c) => c.html(render(authPage("Reset your password", "reset"), c.get("cspNonce"))));
app.get("/jobs", async (c) => { const session = await owner(c); return session ? c.html(render(jobsPage({ email: session.email }), c.get("cspNonce"))) : c.redirect("/auth/linear"); });
app.get("/jobs/new", async (c) => { const session = await owner(c); return session ? c.html(render(jobPage({ email: session.email }), c.get("cspNonce"))) : c.redirect("/auth/linear"); });
app.get("/jobs/:id", async (c) => { const session = await owner(c); return session ? c.html(render(jobDetailPage({ email: session.email }, c.req.param("id")), c.get("cspNonce"))) : c.redirect("/auth/linear"); });
app.get("/jobs/:id/edit", async (c) => { const session = await owner(c); return session ? c.html(render(jobPage({ email: session.email }, c.req.param("id")), c.get("cspNonce"))) : c.redirect("/auth/linear"); });
app.get("/job-runs/:id", async (c) => { const session = await owner(c); return session ? c.html(render(jobRunPage({ email: session.email }, c.req.param("id")), c.get("cspNonce"))) : c.redirect("/auth/linear"); });
app.get("/settings", async (c) => { const session = await owner(c); return session ? c.redirect("/settings/integrations") : c.redirect("/auth/linear"); });
app.get("/settings/integrations", async (c) => { const session = await owner(c); return session ? c.html(render(settingsPage({ email: session.email }), c.get("cspNonce"))) : c.redirect("/auth/linear"); });
app.get("/settings/api-keys", async (c) => { const session = await owner(c); return session ? c.html(render(apiKeysSettingsPage({ email: session.email }), c.get("cspNonce"))) : c.redirect("/auth/linear"); });

export default app;
