import { fetchWithoutRedirects } from "../../transport/http/fetch-without-redirects";
import { browserOwner as owner } from "../../auth/transport/browser-owner";
import { databaseFor } from "../../postgres/database";
import type { BrowserRouter } from "../../runtime/browser-router";
import { createAppJwt, githubHeaders, readSetupState, signSetupState } from "./github";
import { GitHubRepository } from "../../credentials/storage/github-repository";

export function mountGithubOAuthRoutes(app: BrowserRouter) {
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
    const gh = await fetchWithoutRedirects(`https://api.github.com/app/installations/${installationId}`, { headers: githubHeaders(jwt) });
    const installation = await gh.json() as any;
    if (!gh.ok || installation.id !== installationId) return c.text("Could not verify GitHub installation", 502);
    try { await new GitHubRepository(databaseFor(c.env), session.tenantId).save({ installationId, accountLogin: installation.account?.login, accountType: installation.account?.type, state: installation.suspended_at ? "suspended" : "active" }); }
    catch (error) { if (error instanceof Error && error.message === "installation_conflict") return c.text("This GitHub installation is already connected to another tenant", 409); throw error; }
    return c.redirect("/integrations");
  });
}
