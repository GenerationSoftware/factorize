import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

let server, origin, browser;
before(async () => {
  server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://local.test").pathname;
    const file = (/^(\/assets\/|\/theme-init.js$|\/bee-mark-monochrome.png$|\/favicon.ico$)/.test(path)) ? path : "/index.html";
    try { const data = await readFile(new URL("../dist" + file, import.meta.url)); response.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); response.end(data); }
    catch { response.statusCode = 404; response.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });

test("X settings guides app callback setup, validated permissions, and starts owner authorization", async () => {
  const context = await browser.newContext(), page = await context.newPage();
  const connectionId = "18a2410e-ea09-4fe0-af8a-719c0c91e6e2";
  let submitted, connected = false;
  await page.route("**/api/v1/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/session") return route.fulfill({ json: { authenticated: true, user: { id: "owner", email: "owner@example.test" }, workspace: { id: "workspace", name: "Workspace", role: "owner" }, capabilities: ["integrations:read", "integrations:write"] } });
    if (path === "/api/v1/projects") return route.fulfill({ json: [] });
    if (path === "/api/v1/integrations") return route.fulfill({ json: { exeConnections: [], ampConnections: [], cloudflareTail: { installations: [] }, linear: null, clickup: null } });
    if (path.includes("providers/github/installations")) return route.fulfill({ json: [] });
    if (path === "/api/v1/model-accounts") return route.fulfill({ json: { accounts: [], revision: 0 } });
    if (path === "/api/v1/integrations/bearer") return route.fulfill({ json: { integrations: [], revision: 0 } });
    if (path === "/api/v1/integration-api-policies") return route.fulfill({ json: { integrations: [] } });
    if (path === "/api/v1/x/connections" && route.request().method() === "GET") return route.fulfill({ json: { connections: connected ? [{ id: connectionId, name: "My account", clientId: "client-123", scopes: ["tweet.read", "users.read", "offline.access", "tweet.write"], accountId: "12345", accountHandle: "verified_user", grantedScopes: ["tweet.read", "users.read", "offline.access", "tweet.write"], status: "connected", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] : [] } });
    if (path === "/api/v1/x/connections" && route.request().method() === "POST") {
      submitted = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { id: connectionId, name: submitted.name, clientId: submitted.clientId, scopes: submitted.scopes, accountId: null, accountHandle: null, grantedScopes: [], status: "pending", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
    }
    if (path.endsWith("/authorize")) return route.fulfill({ json: { authorizationUrl: "https://x.com/i/oauth2/authorize?response_type=code&state=one-time-state" }, headers: { "Set-Cookie": "factorize_x_oauth_state=opaque; HttpOnly; Secure; SameSite=Lax; Path=/oauth/x/callback; Max-Age=600" } });
    return route.fulfill({ json: {} });
  });
  await page.route("https://x.com/**", route => route.fulfill({ contentType: "text/html", body: "X consent" }));
  await page.goto(origin + "/settings/integrations");
  await page.getByRole("heading", { name: "X connections", exact: true }).waitFor();
  const callback = origin + "/oauth/x/callback";
  await page.locator("code").filter({ hasText: callback }).waitFor({ timeout: 3000 });
  assert.match(await page.getByText(/X Developer Console/).textContent(), /X Developer Console/);
  await page.getByLabel("Connection name", { exact: true }).fill("My account");
  await page.getByLabel("OAuth 2.0 Client ID", { exact: true }).fill("client-123");
  await page.getByLabel("OAuth 2.0 Client Secret", { exact: true }).fill("private-client-secret");
  await page.getByRole("button", { name: "Add post write access" }).click();
  await page.getByRole("button", { name: "Save app and connect X" }).click();
  await page.waitForURL("https://x.com/i/oauth2/authorize**");
  assert.equal(submitted.clientSecret, "private-client-secret");
  assert.deepEqual(submitted.scopes, ["tweet.read", "users.read", "offline.access", "tweet.write"]);
  assert.equal(submitted.name, "My account");
  connected = true;
  await page.goto(origin + "/settings/integrations?x=connected");
  await page.getByRole("status").filter({ hasText: "X account connected and verified" }).waitFor();
  await page.getByText("@verified_user · 12345", { exact: true }).waitFor();
  await page.getByText(/Granted permissions:.*tweet.write/).waitFor();
  await context.close();
});
