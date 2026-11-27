import { fetchWithoutRedirects } from "../../transport/http/fetch-without-redirects";
import { browserOwner as owner } from "../../auth/transport/browser-owner";
import { databaseFor } from "../../postgres/database";
import type { BrowserRouter } from "../../runtime/browser-router";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { signSetupState } from "./github";
import { ConnectionRepository } from "../../credentials/storage/connection-repository";

export function mountClickupOAuthRoutes(app: BrowserRouter) {
  app.get("/auth/clickup", async (c) => {
    const session = await owner(c); if (!session) return c.redirect("/auth/login");
    if (!c.env.CLICKUP_CLIENT_ID) return c.text("ClickUp OAuth is not configured", 503);
    const state = await signSetupState({ tenantId: session.tenantId, userId: session.userId, nonce: crypto.randomUUID(), exp: Math.floor(Date.now() / 1000) + 600 }, c.env.SESSION_SIGNING_SECRET);
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
    const tokenResponse = await fetchWithoutRedirects("https://api.clickup.com/api/v2/oauth/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: c.env.CLICKUP_CLIENT_ID, client_secret: c.env.CLICKUP_CLIENT_SECRET, code }) });
    const tokens = await tokenResponse.json() as { access_token?: string };
    if (!tokenResponse.ok || !tokens.access_token) return c.text("ClickUp token exchange failed", 502);
    const teamsResponse = await fetchWithoutRedirects("https://api.clickup.com/api/v2/team", { headers: { Authorization: tokens.access_token } });
    const teams = await teamsResponse.json() as any, team = teams.teams?.[0];
    if (!teamsResponse.ok || !team?.id) return c.text("Could not identify a ClickUp workspace", 502);
    const hookResponse = await fetchWithoutRedirects(`https://api.clickup.com/api/v2/team/${encodeURIComponent(team.id)}/webhook`, { method: "POST", headers: { Authorization: tokens.access_token, "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: `${c.env.APP_ORIGIN}/webhooks/clickup/${encodeURIComponent(session.tenantId)}`, events: ["taskCreated", "taskUpdated", "taskStatusUpdated", "taskAssigneeUpdated", "taskTagUpdated", "taskMoved"] }) });
    const hook = await hookResponse.json() as any;
    if (!hookResponse.ok || !hook.id) return c.text("Could not register the ClickUp webhook", 502);
    await new ConnectionRepository(databaseFor(c.env), session.tenantId, c.env.CREDENTIAL_ENCRYPTION_KEY).put("clickup", { accessToken: tokens.access_token, teamId: String(team.id), teamName: team.name, webhookId: String(hook.id), webhookSecret: hook.secret });
    deleteCookie(c, "clickup_oauth_state", { path: "/auth/clickup" });
    return c.redirect("/integrations");
  });
}
