import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { equalHmac, hmac } from "./crypto";
import { Tenant } from "./tenant";
import { GitHubInstallationRegistry } from "./github-registry";
import { createAppJwt, githubHeaders, readSetupState, signSetupState } from "./github";
import { flowDetailPage, flowPage, flowsPage, landingPage, runDetailPage } from "./ui";
import type { Env } from "./types";
import type { CustomSource, PipeInput } from "./types";
import { invokeCustomHandler, prepareCustomHandler, validateCustomHandler } from "./custom-handler";
import { generateTailSecret } from "./cloudflare-tail";

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
  if (c.req.path.startsWith("/api/")) return c.json({ error: "Factorize could not complete this request. Try again shortly." }, 502);
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

function tenant(c: { env: Env }, tenantId: string) { return c.env.TENANTS.get(c.env.TENANTS.idFromName(`tenant:${tenantId}`)); }
function githubRegistry(c: { env: Env }) { if (!c.env.GITHUB_INSTALLATIONS) throw new Error("GitHub registry is not configured"); return c.env.GITHUB_INSTALLATIONS.get(c.env.GITHUB_INSTALLATIONS.idFromName("github-installations")); }
async function authed(c: any): Promise<Session | null> { return readSession(getCookie(c, "factorize_session"), c.env.SESSION_SIGNING_SECRET); }
async function owner(c: any): Promise<Session | null> {
  const session = await authed(c); if (!session) return null;
  const response = await tenant(c, session.tenantId).fetch(`https://tenant/members/${session.userId}`);
  if (!response.ok) return null;
  const member = await response.json() as { role: string; session_version: number };
  return member.role === "owner" && member.session_version === session.sessionVersion ? session : null;
}

app.get("/api/health", (c) => c.json({ ok: true }));
app.get("/styles.css", (c) => c.env.ASSETS.fetch(c.req.raw));

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
  const stub = tenant(c, organization.id);
  const memberResponse = await stub.fetch("https://tenant/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: viewer.id, email: viewer.email }) });
  const member = await memberResponse.json() as { role: string; session_version: number };
  if (member.role !== "owner") return c.text("This Factorize tenant requires an owner invitation.", 403);
  await stub.fetch("https://tenant/connections/linear", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token, organizationId: organization.id, organizationName: organization.name }) });
  const lifetime = 60 * 60 * 24 * 7;
  setCookie(c, "factorize_session", await signSession({ tenantId: organization.id, userId: viewer.id, email: viewer.email, exp: Math.floor(Date.now() / 1000) + lifetime, sessionVersion: member.session_version }, c.env.SESSION_SIGNING_SECRET), { httpOnly: true, secure: new URL(c.env.APP_ORIGIN).protocol === "https:", sameSite: "Lax", path: "/", maxAge: lifetime });
  const oauthReturn = getCookie(c, "factorize_oauth_return");
  if (oauthReturn?.startsWith("/authorize?")) { deleteCookie(c, "factorize_oauth_return", { path: "/" }); return c.redirect(oauthReturn); }
  return c.redirect("/flows/new");
});

app.post("/auth/logout", (c) => {
  deleteCookie(c, "factorize_session", { path: "/" });
  return c.redirect("/");
});

app.get("/api/pipes", async (c) => {
  const session = await owner(c); if (!session) return c.json({ error: "Unauthorized" }, 401);
  return tenant(c, session.tenantId).fetch("https://tenant/pipes");
});
app.get("/api/pipes/:id", async (c) => {
  const session = await owner(c); if (!session) return c.json({ error: "Unauthorized" }, 401);
  return tenant(c, session.tenantId).fetch(`https://tenant/pipes/${encodeURIComponent(c.req.param("id"))}`);
});
app.get("/api/runs", async (c) => {
  const session = await owner(c); if (!session) return c.json({ error: "Unauthorized" }, 401);
  return tenant(c, session.tenantId).fetch("https://tenant/runs");
});
app.get("/api/runs/:id", async (c) => {
  const session = await owner(c); if (!session) return c.json({ error: "Unauthorized" }, 401);
  return tenant(c, session.tenantId).fetch(`https://tenant/runs/${encodeURIComponent(c.req.param("id"))}`);
});
app.get("/api/connections/status", async (c) => {
  const session = await owner(c); if (!session) return c.json({ error: "Unauthorized" }, 401);
  return tenant(c, session.tenantId).fetch("https://tenant/connections/status");
});
app.get("/api/linear/projects", async (c) => {
  const session = await owner(c); if (!session) return c.json({ error: "Unauthorized" }, 401);
  return tenant(c, session.tenantId).fetch("https://tenant/linear/projects");
});
app.get("/api/linear/options", async (c) => {
  const session = await owner(c); if (!session) return c.json({ error: "Unauthorized" }, 401);
  return tenant(c, session.tenantId).fetch("https://tenant/linear/options");
});
app.get("/api/github/installations", async (c) => {
  const session = await owner(c); if (!session) return c.json({ error: "Unauthorized" }, 401);
  if (c.env.GITHUB_INTEGRATION_ENABLED !== "true") return c.json({ error: "GitHub integration is not enabled" }, 404);
  return tenant(c, session.tenantId).fetch("https://tenant/github/installations");
});
app.get("/api/github/installations/:id/repositories", async (c) => {
  const session = await owner(c); if (!session) return c.json({ error: "Unauthorized" }, 401);
  if (c.env.GITHUB_INTEGRATION_ENABLED !== "true") return c.json({ error: "GitHub integration is not enabled" }, 404);
  return tenant(c, session.tenantId).fetch(`https://tenant/github/installations/${encodeURIComponent(c.req.param("id"))}/repositories`);
});
app.delete("/api/github/installations/:id", async (c) => {
  const session = await owner(c); if (!session) return c.json({ error: "Unauthorized" }, 401);
  if (c.env.GITHUB_INTEGRATION_ENABLED !== "true") return c.json({ error: "GitHub integration is not enabled" }, 404);
  const response = await tenant(c, session.tenantId).fetch(`https://tenant/github/installations/${encodeURIComponent(c.req.param("id"))}`, { method: "DELETE" });
  if (response.ok) await githubRegistry(c).fetch(`https://registry/installations/${encodeURIComponent(c.req.param("id"))}`, { method: "DELETE" });
  return response;
});
app.get("/auth/github/install", async (c) => {
  const session = await owner(c); if (!session) return c.redirect("/auth/linear");
  if (c.env.GITHUB_INTEGRATION_ENABLED !== "true" || !c.env.GITHUB_APP_SLUG) return c.text("GitHub integration is not enabled", 404);
  const nonce = crypto.randomUUID();
  const state = await signSetupState({ tenantId: session.tenantId, userId: session.userId, nonce, exp: Math.floor(Date.now() / 1000) + 600 }, c.env.SESSION_SIGNING_SECRET);
  await tenant(c, session.tenantId).fetch("https://tenant/github/setup-state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nonce, exp: Math.floor(Date.now() / 1000) + 600 }) });
  return c.redirect(`https://github.com/apps/${encodeURIComponent(c.env.GITHUB_APP_SLUG)}/installations/new?state=${encodeURIComponent(state)}`);
});
app.get("/auth/github/setup", async (c) => {
  const session = await owner(c); if (!session) return c.text("Unauthorized", 401);
  const state = await readSetupState(c.req.query("state") ?? "", c.env.SESSION_SIGNING_SECRET);
  const installationId = Number(c.req.query("installation_id"));
  if (!state || state.tenantId !== session.tenantId || state.userId !== session.userId || !Number.isSafeInteger(installationId)) return c.text("Invalid or expired setup state", 400);
  const consume = await tenant(c, session.tenantId).fetch("https://tenant/github/setup-state/consume", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nonce: state.nonce }) });
  if (!consume.ok) return c.text("Setup state was already used", 400);
  if (!c.env.GITHUB_APP_ID || !c.env.GITHUB_APP_PRIVATE_KEY) return c.text("GitHub App is not configured", 503);
  const jwt = await createAppJwt(c.env.GITHUB_APP_ID, c.env.GITHUB_APP_PRIVATE_KEY.replaceAll("\\n", "\n"));
  const gh = await fetch(`https://api.github.com/app/installations/${installationId}`, { headers: githubHeaders(jwt) });
  const installation = await gh.json() as any;
  if (!gh.ok || installation.id !== installationId) return c.text("Could not verify GitHub installation", 502);
  const bind = await githubRegistry(c).fetch(`https://registry/installations/${installationId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenantId: session.tenantId, accountLogin: installation.account?.login, accountType: installation.account?.type, state: installation.suspended_at ? "suspended" : "active" }) });
  if (!bind.ok) return c.text("This GitHub installation is already connected to another tenant", 409);
  await tenant(c, session.tenantId).fetch("https://tenant/github/installations", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ installationId, accountLogin: installation.account?.login, accountType: installation.account?.type, state: installation.suspended_at ? "suspended" : "active" }) });
  return c.redirect("/flows/new");
});
app.put("/api/connections/exe", async (c) => {
  const session = await owner(c); if (!session) return c.json({ error: "Unauthorized" }, 401);
  return tenant(c, session.tenantId).fetch("https://tenant/connections/exe", { method: "PUT", headers: { "Content-Type": "application/json" }, body: await c.req.text() });
});
app.post("/api/connections/exe/test", async (c) => {
  const session = await owner(c); if (!session) return c.json({ error: "Unauthorized" }, 401);
  return tenant(c, session.tenantId).fetch("https://tenant/connections/exe/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: await c.req.text() });
});
app.post("/api/pipes", async (c) => {
  const session = await owner(c); if (!session) return c.json({ error: "Unauthorized" }, 401);
  const input = await c.req.json() as PipeInput;
  if (input.source?.kind === "custom") {
    if (c.env.CUSTOM_SOURCES_ENABLED !== "true") return c.json({ error: "Custom sources are not enabled." }, 404);
    const valid = validateCustomHandler(input.source.origin, input.source.handlerName, input.source.handlerCode);
    const pipeId = crypto.randomUUID();
    input.pipeId = pipeId;
    input.source = await prepareCustomHandler(session.tenantId, pipeId, { kind: "custom", ...valid, ...(valid.origin === "cloudflare" ? { tail: { signingSecret: generateTailSecret() } } : {}) });
  }
  const response = await tenant(c, session.tenantId).fetch("https://tenant/pipes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  if (!response.ok || input.source?.kind !== "custom" || input.source.origin !== "cloudflare") return response;
  const result = await response.json() as Record<string, unknown>;
  return c.json({ ...result, cloudflareTail: { destination: `${c.env.APP_ORIGIN}/webhooks/cloudflare/${encodeURIComponent(session.tenantId)}/${encodeURIComponent(String(input.pipeId))}`, signingSecret: input.source.tail?.signingSecret } }, 201);
});
app.put("/api/pipes/:id", async (c) => {
  const session = await owner(c); if (!session) return c.json({ error: "Unauthorized" }, 401);
  const pipeId = c.req.param("id"), input = await c.req.json() as PipeInput;
  if (input.source?.kind === "custom") {
    if (c.env.CUSTOM_SOURCES_ENABLED !== "true") return c.json({ error: "Custom sources are not enabled." }, 404);
    const currentResponse = await tenant(c, session.tenantId).fetch(`https://tenant/pipes/${encodeURIComponent(pipeId)}`);
    if (!currentResponse.ok) return currentResponse;
    const current = await currentResponse.json() as { flow: { source_config?: string } };
    let previous: CustomSource | undefined;
    try { const source = JSON.parse(current.flow.source_config ?? "{}"); if (source.kind === "custom") previous = source; } catch { /* fail closed */ }
    const valid = validateCustomHandler(input.source.origin, input.source.handlerName, input.source.handlerCode);
    input.source = await prepareCustomHandler(session.tenantId, pipeId, { kind: "custom", ...valid }, previous);
  }
  return tenant(c, session.tenantId).fetch(`https://tenant/pipes/${encodeURIComponent(pipeId)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
});
app.delete("/api/pipes/:id", async (c) => {
  const session = await owner(c); if (!session) return c.json({ error: "Unauthorized" }, 401);
  const pipeId = c.req.param("id");
  return tenant(c, session.tenantId).fetch(`https://tenant/pipes/${encodeURIComponent(pipeId)}`, { method: "DELETE" });
});

app.post("/api/custom-handlers/test", async (c) => {
  const session = await owner(c); if (!session) return c.json({ error: "Unauthorized" }, 401);
  if (c.env.CUSTOM_SOURCES_ENABLED !== "true" || !c.env.CUSTOM_HANDLER_LOADER) return c.json({ error: "Custom sources are not enabled." }, 404);
  const input = await c.req.json() as { origin?: unknown; handlerName?: unknown; handlerCode?: unknown; payload?: unknown };
  const valid = validateCustomHandler(input.origin, input.handlerName, input.handlerCode);
  const testId = `test-${crypto.randomUUID()}`;
  const source = await prepareCustomHandler(session.tenantId, testId, { kind: "custom", ...valid });
  return c.json(await invokeCustomHandler(c.env.CUSTOM_HANDLER_LOADER, source, input.payload));
});

app.post("/api/pipes/:id/cloudflare-tail/test", async (c) => {
  const session = await owner(c); if (!session) return c.json({ error: "Unauthorized" }, 401);
  return tenant(c, session.tenantId).fetch(`https://tenant/cloudflare-tail/${encodeURIComponent(c.req.param("id"))}/test`, { method: "POST" });
});

app.post("/webhooks/cloudflare/:tenantId/:flowId", async (c) => {
  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).byteLength > 262_144) return c.text("Payload too large", 413);
  return tenant(c, c.req.param("tenantId")).fetch(`https://tenant/webhook/cloudflare/${encodeURIComponent(c.req.param("flowId"))}`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Factorize-Timestamp": c.req.header("X-Factorize-Timestamp") ?? "", "X-Factorize-Delivery": c.req.header("X-Factorize-Delivery") ?? "", "X-Factorize-Signature": c.req.header("X-Factorize-Signature") ?? "" }, body: raw,
  });
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
  return tenant(c, organizationId).fetch("https://tenant/webhook/linear", { method: "POST", headers: { "Content-Type": "application/json", "Linear-Delivery": `linear:${deliveryId}` }, body: raw });
});

app.post("/webhooks/github", async (c) => {
  if (c.env.GITHUB_INTEGRATION_ENABLED !== "true") return c.text("Not found", 404);
  if (!c.env.GITHUB_WEBHOOK_SECRET) return c.text("Webhook verification is not configured", 503);
  const raw = await c.req.text();
  const signature = c.req.header("X-Hub-Signature-256") ?? "";
  if (!signature.startsWith("sha256=") || !(await equalHmac(raw, signature.slice(7), c.env.GITHUB_WEBHOOK_SECRET))) return c.text("Invalid signature", 401);
  const delivery = c.req.header("X-GitHub-Delivery"), eventName = c.req.header("X-GitHub-Event");
  if (!delivery || !eventName) return c.text("Missing GitHub headers", 400);
  let event: any; try { event = JSON.parse(raw); } catch { return c.text("Invalid JSON", 400); }
  const installationId = event.installation?.id;
  if (!Number.isSafeInteger(installationId)) return c.text("Missing installation ID", 400);
  const registryResponse = await githubRegistry(c).fetch(`https://registry/installations/${installationId}`);
  if (!registryResponse.ok) { console.info(JSON.stringify({ event: "github_webhook_unrouted", installationId, delivery, eventName })); return c.body(null, 202); }
  const registration = await registryResponse.json() as any;
  if (eventName === "installation" && ["deleted", "suspend", "unsuspend"].includes(event.action)) {
    const state = event.action === "unsuspend" ? "active" : event.action === "suspend" ? "suspended" : "removed";
    await tenant(c, registration.tenant_id).fetch(`https://tenant/github/installations/${installationId}/state`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state }) });
    await githubRegistry(c).fetch(`https://registry/installations/${installationId}`, event.action === "deleted" ? { method: "DELETE" } : { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state }) });
    return c.body(null, 202);
  }
  if (registration.state !== "active") return c.body(null, 202);
  return tenant(c, registration.tenant_id).fetch("https://tenant/webhook/github", { method: "POST", headers: { "Content-Type": "application/json", "GitHub-Delivery": `github:${delivery}`, "GitHub-Event": eventName }, body: raw });
});

const render = (page: string, nonce: string) => page.replaceAll("<script>", `<script nonce="${nonce}">`);

app.get("/", async (c) => {
  const session = await owner(c);
  return c.html(render(landingPage(session ? { email: session.email } : null), c.get("cspNonce")));
});
app.get("/flows/new", async (c) => {
  const session = await owner(c);
  return c.html(render(flowPage(session ? { email: session.email } : null), c.get("cspNonce")));
});
app.get("/flows", async (c) => {
  const session = await owner(c);
  if (!session) return c.redirect("/auth/linear");
  return c.html(render(flowsPage({ email: session.email }), c.get("cspNonce")));
});
app.get("/flows/:id", async (c) => {
  const session = await owner(c);
  if (!session) return c.redirect("/auth/linear");
  return c.html(render(flowDetailPage({ email: session.email }, c.req.param("id")), c.get("cspNonce")));
});
app.get("/flows/:id/edit", async (c) => {
  const session = await owner(c);
  if (!session) return c.redirect("/auth/linear");
  return c.html(render(flowPage({ email: session.email }, c.req.param("id")), c.get("cspNonce")));
});
app.get("/runs/:id", async (c) => {
  const session = await owner(c);
  if (!session) return c.redirect("/auth/linear");
  return c.html(render(runDetailPage({ email: session.email }, c.req.param("id")), c.get("cspNonce")));
});

export { Tenant, GitHubInstallationRegistry };
export default app;
