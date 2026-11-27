import { fetchWithoutRedirects } from "../../transport/http/fetch-without-redirects";
import { browserOwner as owner } from "../../auth/transport/browser-owner";
import { databaseFor } from "../../postgres/database";
import type { BrowserRouter } from "../../runtime/browser-router";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { readSetupState, signSetupState } from "./github";
import { ConnectionRepository } from "../../credentials/storage/connection-repository";

export function mountLinearOAuthRoutes(app: BrowserRouter) {
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
    const tokenResponse = await fetchWithoutRedirects("https://api.linear.app/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, redirect_uri: `${c.env.APP_ORIGIN}/auth/linear/callback`, client_id: c.env.LINEAR_CLIENT_ID, client_secret: c.env.LINEAR_CLIENT_SECRET, grant_type: "authorization_code" }) });
    const tokens = await tokenResponse.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!tokenResponse.ok || !tokens.access_token || !tokens.refresh_token) return c.text("Linear token exchange failed", 502);
    const meResponse = await fetchWithoutRedirects("https://api.linear.app/graphql", { method: "POST", headers: { Authorization: `Bearer ${tokens.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: "query { viewer { id email } organization { id name } }" }) });
    const me = await meResponse.json() as any;
    const organization = me.data?.organization;
    const viewer = me.data?.viewer;
    if (!organization?.id || !viewer?.id) return c.text("Could not identify Linear workspace", 502);
    const connected = await new ConnectionRepository(databaseFor(c.env), session.tenantId, c.env.CREDENTIAL_ENCRYPTION_KEY).putLinear(organization.id, { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, accessTokenExpiresAt: Number.isFinite(tokens.expires_in) ? new Date(Date.now() + tokens.expires_in! * 1000).toISOString() : null, organizationId: organization.id, organizationName: organization.name, viewerId: viewer.id, viewerEmail: viewer.email });
    if (!connected) return c.text("This Linear workspace is already connected to another Factorize workspace. Sign in to that Factorize account to manage it.", 409);
    return c.redirect("/integrations");
  });
}
