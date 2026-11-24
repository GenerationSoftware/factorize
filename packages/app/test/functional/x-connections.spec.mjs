import assert from "node:assert/strict";
import { test } from "./fixtures.mjs";

let origin, browser;
test.beforeAll(async ({ origin: appOrigin, browser: chromium }) => {
  origin = appOrigin;
  browser = chromium;
});

test("X settings guides app callback setup, validated permissions, and starts owner authorization", async () => {
  const context = await browser.newContext(), page = await context.newPage();
  const connectionId = "18a2410e-ea09-4fe0-af8a-719c0c91e6e2";
  let submitted, connected = false;
  await page.route("**/api/v1/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/session") return route.fulfill({ json: { authenticated: true, user: { id: "owner", email: "owner@example.test" }, team: { id: "workspace", name: "Workspace", role: "owner" }, capabilities: ["integrations:read", "integrations:write"] } });
    if (path === "/api/v1/fly/connection") return route.fulfill({json:{connection:null}});
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
  await page.getByRole("button", {name:"Add X integration",exact:true}).click();
  await page.getByRole("dialog",{name:"Add X integration",exact:true}).waitFor();
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

test("X settings explains terminal authorization failures and offers an explicit reconnect", async () => {
  const context = await browser.newContext(), page = await context.newPage();
  const connectionId = "7d2edbbf-aac8-4f20-9b70-818bc5c03294";
  let authorizeCalls = 0;
  await page.route("**/api/v1/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/session") return route.fulfill({ json: { authenticated: true, user: { id: "owner", email: "owner@example.test" }, team: { id: "workspace", name: "Workspace", role: "owner" }, capabilities: ["integrations:read", "integrations:write"] } });
    if (path === "/api/v1/fly/connection") return route.fulfill({json:{connection:null}});
    if (path === "/api/v1/projects") return route.fulfill({ json: [] });
    if (path === "/api/v1/integrations") return route.fulfill({ json: { exeConnections: [], ampConnections: [], cloudflareTail: { installations: [] }, linear: null, clickup: null } });
    if (path.includes("providers/github/installations")) return route.fulfill({ json: [] });
    if (path === "/api/v1/model-accounts") return route.fulfill({ json: { accounts: [], revision: 0 } });
    if (path === "/api/v1/integrations/bearer") return route.fulfill({ json: { integrations: [], revision: 0 } });
    if (path === "/api/v1/integration-api-policies") return route.fulfill({ json: { integrations: [] } });
    if (path === "/api/v1/x/connections") return route.fulfill({ json: { connections: [{ id: connectionId, name: "Work account", clientId: "client-123", scopes: ["tweet.read", "users.read", "offline.access"], accountId: "123", accountHandle: "work_user", grantedScopes: ["tweet.read", "users.read", "offline.access"], status: "reconnect_required", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] } });
    if (path.endsWith("/authorize")) { authorizeCalls++; return route.fulfill({ json: { authorizationUrl: "https://x.com/i/oauth2/authorize?state=fresh" } }); }
    return route.fulfill({ json: {} });
  });
  await page.route("https://x.com/**", route => route.fulfill({ contentType: "text/html", body: "X consent" }));
  await page.goto(origin + "/settings/integrations");
  await page.getByText("Needs attention", { exact: true }).waitFor();
  await page.getByLabel("Actions for X · Work account",{exact:true}).click();
  await page.getByRole("menuitem", { name: "Connect X", exact: true }).click();
  await page.waitForURL("https://x.com/i/oauth2/authorize**");
  assert.equal(authorizeCalls, 1);
  await context.close();
});

test("X owner can test safely and replace app credentials before same-account reauthorization", async () => {
  const context = await browser.newContext(), page = await context.newPage();
  const connectionId = "47d2f592-0f70-40a9-8cea-37b34d2a1573";
  let replacement, tested = 0;
  await page.route("**/api/v1/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/session") return route.fulfill({ json: { authenticated: true, user: { id: "owner", email: "owner@example.test" }, team: { id: "workspace", name: "Workspace", role: "owner" }, capabilities: ["integrations:read", "integrations:write"] } });
    if (path === "/api/v1/fly/connection") return route.fulfill({json:{connection:null}});
    if (path === "/api/v1/projects") return route.fulfill({ json: [] });
    if (path === "/api/v1/integrations") return route.fulfill({ json: { exeConnections: [], ampConnections: [], cloudflareTail: { installations: [] }, linear: null, clickup: null } });
    if (path.includes("providers/github/installations")) return route.fulfill({ json: [] });
    if (path === "/api/v1/model-accounts") return route.fulfill({ json: { accounts: [], revision: 0 } });
    if (path === "/api/v1/integrations/bearer") return route.fulfill({ json: { integrations: [], revision: 0 } });
    if (path === "/api/v1/integration-api-policies") return route.fulfill({ json: { integrations: [] } });
    if (path === `/api/v1/x/connections/${connectionId}/test`) { tested++; return route.fulfill({ json: { status: "failed", accountHandle: "work_user", message: "X could not verify the connection. Try again later." } }); }
    if (path === `/api/v1/x/connections/${connectionId}/credentials` && route.request().method() === "PUT") { replacement = route.request().postDataJSON(); return route.fulfill({ json: { id: connectionId, name: "Work account", clientId: replacement.clientId, scopes: ["tweet.read", "users.read", "offline.access"], accountId: "123", accountHandle: "work_user", grantedScopes: [], status: "reconnect_required", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }); }
    if (path === `/api/v1/x/connections/${connectionId}/authorize`) return route.fulfill({ json: { authorizationUrl: "https://x.com/i/oauth2/authorize?state=replacement" } });
    if (path === "/api/v1/x/connections") return route.fulfill({ json: { connections: [{ id: connectionId, name: "Work account", clientId: "client-123", scopes: ["tweet.read", "users.read", "offline.access"], accountId: "123", accountHandle: "work_user", grantedScopes: ["tweet.read", "users.read", "offline.access"], status: "connected", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] } });
    return route.fulfill({ json: {} });
  });
  await page.route("https://x.com/**", route => route.fulfill({ contentType: "text/html", body: "X consent" }));
  await page.goto(origin + "/settings/integrations");
  await page.getByLabel("Actions for X · Work account",{exact:true}).click();
  await page.getByRole("menuitem", { name: "Test connection",exact:true }).click();
  await page.getByRole("status").filter({ hasText: "X could not verify the connection" }).waitFor();
  assert.equal(tested, 1);
  await page.getByLabel("Actions for X · Work account",{exact:true}).click();
  await page.getByRole("menuitem", { name: "Replace app credentials" }).click();
  await page.getByRole("dialog",{name:"Replace X app credentials",exact:true}).waitFor();
  await page.getByLabel("Replacement OAuth 2.0 Client ID").fill("replacement-client");
  await page.getByLabel("Replacement OAuth 2.0 Client Secret").fill("replacement-secret");
  await page.getByRole("button", { name: "Replace credentials and reauthorize" }).click();
  await page.waitForURL("https://x.com/i/oauth2/authorize**");
  assert.deepEqual(replacement, { clientId: "replacement-client", clientSecret: "replacement-secret" });
  assert.equal(await page.getByText("replacement-secret", { exact: true }).count(), 0);
  await context.close();
});
