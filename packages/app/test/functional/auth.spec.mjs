import assert from "node:assert/strict";
import { test } from "./fixtures.mjs";

let origin, browser;
test.beforeAll(async ({ origin: appOrigin, browser: chromium }) => {
  origin = appOrigin;
  browser = chromium;
});

async function pageFor(path, options = {}) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await page.route("**/api/v1/session", route => route.fulfill({ json: { authenticated: false } }));
  await page.goto(origin + path);
  return { page, context };
}
const waitText = async (page, role, text) => {
  await page.getByRole(role).filter({ hasText: text }).waitFor();
};

test("login handles errors, prevents duplicate submissions and sends explicit typed form data", async () => {
  const { page, context } = await pageFor("/auth/login");
  let count = 0;
  let submitted;
  let release;
  await page.route("**/api/v1/auth/login", async route => {
    count++;
    submitted = route.request().postDataJSON();
    await new Promise(resolve => { release = resolve; });
    await route.fulfill({ status: 401, json: { error: { code: "invalid_token", message: "Invalid email or password." } } });
  });
  await page.getByLabel("Username or email", { exact: true }).fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("long-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("main form button")?.disabled);
  assert.equal(await page.locator("main form").getByRole("button").isDisabled(), true);
  release();
  await waitText(page, "alert", "Invalid email or password.");
  assert.equal(count, 1);
  assert.deepEqual(submitted, { email: "owner@example.test", password: "long-test-password" });
  assert.equal(await page.locator("main form").getByRole("button").isDisabled(), false);
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  await context.close();
});

test("signup and verification requests use non-enumerating feedback", async () => {
  for (const [path, endpoint] of [
    ["/auth/signup", "/api/v1/auth/signup"],
    ["/auth/verify/request", "/api/v1/auth/email-verification/request"],
    ["/auth/password-reset", "/api/v1/auth/password-reset/request"],
  ]) {
    const { page, context } = await pageFor(path);
    await page.route("**" + endpoint, route => route.fulfill({ status: path === "/auth/signup" ? 202 : 200, json: { ok: true } }));
    await page.getByLabel("Email", { exact: true }).fill("owner@example.test");
    if (path === "/auth/signup") { await page.getByLabel("Username", { exact: true }).fill("owner"); await page.getByLabel("New password", { exact: true }).fill("long-test-password"); }
    await page.getByRole("button", { name: "Continue" }).click();
    await waitText(page, "status", "check your inbox");
    await context.close();
  }
});

test("reset and verification deep links survive refresh and retain their token until an explicit submit", async () => {
  for (const [path, endpoint] of [
    ["/auth/password-reset?token=reset-token", "/api/v1/auth/password-reset/complete"],
    ["/auth/verify?token=verify-token", "/api/v1/auth/email-verification/complete"],
  ]) {
    const { page, context } = await pageFor(path);
    let count = 0;
    let submitted;
    await page.route("**" + endpoint, route => {
      count++; submitted = route.request().postDataJSON();
      return route.fulfill({ json: { ok: true } });
    });
    await page.reload();
    await page.getByRole("heading", { level: 1 }).waitFor();
    assert.equal(count, 0);
    if (path.startsWith("/auth/password-reset")) await page.getByLabel("New password", { exact: true }).fill("long-test-password");
    await page.locator("main form").getByRole("button").click();
    await page.getByRole("status").waitFor();
    assert.equal(count, 1);
    assert.equal(submitted.token, path.includes("reset") ? "reset-token" : "verify-token");
    await context.close();
  }
});

test("mobile layout, keyboard navigation and client links remain usable", async () => {
  const { page, context } = await pageFor("/auth/login", { viewport: { width: 375, height: 812 }, isMobile: true });
  await page.getByLabel("Username or email", { exact: true }).focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.getByLabel("Password", { exact: true }).evaluate(el => el === document.activeElement), true);
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await waitText(page, "heading", "Reset password");
  assert.equal(new URL(page.url()).pathname, "/auth/password-reset");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await context.close();
});

test("password route redirects an unauthenticated viewer to login with a local return path", async () => {
  const { page, context } = await pageFor("/settings/password");
  await waitText(page, "heading", "Sign in");
  assert.equal(new URL(page.url()).pathname, "/auth/login");
  assert.equal(new URL(page.url()).searchParams.get("returnTo"), "/settings/password");
  await context.close();
});

test("Account settings opens from the account menu and keeps account pages together", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.route("**/api/v1/session", route => route.fulfill({ json: {
    authenticated: true, user: { id: "owner-a", email: "owner@example.test" },
    team: { id: "workspace-a", name: "Workspace", role: "owner" }, capabilities: [],
  } }));
  await page.route("**/api/v1/profile", route => route.fulfill({ json: { username: "owner", email: "owner@example.test" } }));
  await page.route("**/api/v1/access-tokens", route => route.fulfill({ json: [] }));
  await page.goto(origin + "/settings/password");
  await page.getByRole("button", { name: "Your account", exact: true }).click();
  await page.getByRole("link", { name: "Account settings", exact: true }).click();
  await page.getByRole("heading", { name: "Profile", exact: true }).waitFor();

  const settings = page.getByRole("navigation", { name: "Account settings", exact: true });
  assert.deepEqual(await settings.getByRole("link").allTextContents(), ["Profile", "API keys", "Two-factor authentication", "Change password"]);
  const dashboard = page.getByRole("navigation", { name: "Dashboard navigation" });
  assert.equal(await dashboard.locator('[aria-current="page"]').count(), 0);
  assert.equal(await dashboard.locator(".border-factorize-500").count(), 0);

  const keys = settings.getByRole("link", { name: "API keys", exact: true });
  await keys.click();
  await page.getByRole("button", { name: "Create API Key", exact: true }).click();
  await page.getByRole("heading", { name: "Create API key", exact: true }).waitFor();
  assert.equal(await keys.getAttribute("aria-current"), "page");

  const password = settings.getByRole("link", { name: "Change password", exact: true });
  await password.click();
  await page.getByRole("heading", { name: "Change password", exact: true }).waitFor();
  assert.equal(await password.getAttribute("aria-current"), "page");
  assert.match(await password.getAttribute("class"), /bg-factorize-50/);
  await context.close();
});

test("Settings navigation keeps the Settings tab active and shares integration policies across pages", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.route("**/api/v1/session", route => route.fulfill({ json: {
    authenticated: true, user: { id: "owner-a", email: "owner@example.test" },
    team: { id: "workspace-a", name: "Workspace", role: "owner" }, capabilities: [],
  } }));
  const policyId = "18a2410e-ea09-4fe0-af8a-719c0c91e6e2";
  let current = { scope: `integration:${policyId}:1`, integrationId: policyId, credentialId: "linear", name: "Linear",
    kind: "linear", available: true, isDefault: false, preferenceSet: false };
  await page.route("**/api/v1/team-permissions", route => {
    if (route.request().method() === "PUT") {
      assert.deepEqual(route.request().postDataJSON(), { scope: current.scope, isDefault: true });
      current = { ...current, preferenceSet: true, isDefault: true };
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: [current] });
  });
  await page.route("**/api/v1/apps", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/integrations", route => route.fulfill({ json: {
    exeConnections: [], ampConnections: [], cloudflareTail: { installations: [] }, linear: { organizationName: "Workspace" }, clickup: null,
  } }));
  await page.route("**/api/v1/providers/github/installations", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/fly/connection", route => route.fulfill({ json: { connection: null } }));
  await page.route("**/api/v1/integrations/bearer", route => route.fulfill({ json: { integrations: [], revision: 0 } }));
  await page.route("**/api/v1/x/connections", route => route.fulfill({ json: { connections: [] } }));
  await page.goto(origin + "/settings");
  await page.getByRole("heading", { name: "Permissions", exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/settings/permissions");
  const dashboard = page.getByRole("navigation", { name: "Dashboard navigation" });
  const settings = page.getByRole("navigation", { name: "Settings", exact: true });
  assert.deepEqual(await settings.getByRole("link").allTextContents(), ["Permissions", "Registered apps", "Integrations"]);
  assert.deepEqual(await dashboard.locator('[aria-current="page"]').allTextContents(), ["Settings"]);
  assert.deepEqual(await dashboard.locator(".border-factorize-500").allTextContents(), ["Settings"]);
  await settings.getByRole("link", { name: "Registered apps", exact: true }).click();
  await page.getByText("No registered apps.").waitFor();
  assert.equal(new URL(page.url()).pathname, "/settings/apps");
  assert.deepEqual(await dashboard.locator('[aria-current="page"]').allTextContents(), ["Settings"]);
  assert.deepEqual(await dashboard.locator(".border-factorize-500").allTextContents(), ["Settings"]);
  await settings.getByRole("link", { name: "Permissions", exact: true }).click();
  await page.getByRole("heading", { name: "Permissions", exact: true }).waitFor();
  await page.getByRole("combobox", { name: "Linear default preference", exact: true }).waitFor();

  await settings.getByRole("link", { name: "Integrations", exact: true }).click();
  const linearPolicy = page.getByRole("combobox", { name: "Linear default preference", exact: true });
  await linearPolicy.waitFor();
  await page.getByText("Make this integration a default for new connections?", { exact: false }).waitFor();
  await linearPolicy.selectOption("default");
  assert.deepEqual(await dashboard.locator('[aria-current="page"]').allTextContents(), ["Settings"]);
  assert.deepEqual(await dashboard.locator(".border-factorize-500").allTextContents(), ["Settings"]);

  await settings.getByRole("link", { name: "Permissions", exact: true }).click();
  await page.getByRole("combobox", { name: "Linear default preference", exact: true }).waitFor();
  assert.equal(await page.getByRole("combobox", { name: "Linear default preference", exact: true }).inputValue(), "default");
  await context.close();
});

test("authenticated password change is isolated from global auth navigation and reports invalidation", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  let active = true;
  await page.route("**/api/v1/session", route => route.fulfill({ json: active ? {
    authenticated: true, user: { id: "owner-a", email: "owner@example.test" },
    team: { id: "workspace-a", name: "Workspace", role: "owner" }, capabilities: [],
  } : { authenticated: false } }));
  await page.route("**/api/v1/auth/password", async route => {
    assert.deepEqual(route.request().postDataJSON(), { currentPassword: "old-test-password", password: "new-test-password" });
    active = false;
    await route.fulfill({ json: { ok: true }, headers: { "Set-Cookie": "factorize_session=; Max-Age=0; Path=/" } });
  });
  await page.goto(origin + "/settings/password");
  assert.equal(await page.getByRole("navigation", { name: "Account", exact: true }).count(), 0);
  await page.getByLabel("Current password", { exact: true }).fill("old-test-password");
  await page.getByLabel("New password", { exact: true }).fill("new-test-password");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await waitText(page, "status", "Password updated. Sign in with your new password.");
  assert.equal(await page.getByRole("navigation", { name: "Account", exact: true }).count(), 0);
  await context.close();
});

test("password recovery keeps its unauthenticated auth navigation", async () => {
  const { page, context } = await pageFor("/auth/password-reset");
  await page.getByRole("heading", { name: "Reset password" }).waitFor();
  const account = page.getByRole("navigation", { name: "Account" });
  await account.getByRole("link", { name: "Sign in", exact: true }).waitFor();
  await account.getByRole("link", { name: "Resend verification", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Current password", { exact: true }).count(), 0);
  await context.close();
});

test("logout refreshes session identity and removes the account display", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  let active = true;
  await page.route("**/api/v1/session", route => route.fulfill({ json: active ? {
    authenticated: true, user: { id: "owner-a", email: "owner@example.test" },
    team: { id: "workspace-a", name: "Workspace", role: "owner" },
    capabilities: ["team:read", "triggers:read", "integrations:read"], expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  } : { authenticated: false } }));
  await page.route("**/api/v1/auth/logout", route => { active = false; return route.fulfill({ json: { ok: true } }); });
  await page.goto(origin + "/");
  await page.getByRole("button", { name: "Your account", exact: true }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.locator("#profile-menu").waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  await context.close();
});

test("MCP onboarding preserves the attempt across account links and resumes automatically after verification elsewhere", async () => {
  const context = await browser.newContext(), page = await context.newPage();
  let verified = false, active = false, grants = 0;
  const connection = "11111111-1111-4111-8111-111111111111";
  const returnTo = `/authorize?client_id=cli&state=original&connection=${connection}`;
  await page.route("**/api/v1/session", route => route.fulfill({ json: active ? { authenticated: true, user: { id: "owner", email: "new@example.test" }, team: { id: "workspace", role: "owner" }, capabilities: [] } : { authenticated: false } }));
  await page.route("**/api/v1/auth/connections/resume", route => {
    assert.equal(route.request().postDataJSON().connection, connection);
    if (verified) active = true;
    return route.fulfill({ json: verified ? { ok: true, returnTo } : { ok: true, pending: true, clientName: "My MCP CLI" } });
  });
  await page.route("**/api/v1/auth/signup", route => { assert.deepEqual(route.request().postDataJSON(), { email: "new@example.test", username: "new-user", password: "long-test-password", connection }); return route.fulfill({ status: 202, json: { ok: true } }); });
  await page.route("**/api/v1/oauth/consent/preview", route => route.fulfill({ json: { clientName: "My MCP CLI", scopes: ["team:read", "triggers:read", "integrations:read"], request: "signed", signature: "signature", expiresAt: new Date(Date.now() + 600000).toISOString() } }));
  await page.route("**/api/v1/oauth/consent/decision", route => { grants++; assert.equal(route.request().postDataJSON().decision, "allow"); return route.fulfill({ json: { redirectTo: origin + "/completed?code=grant" } }); });
  await page.goto(origin + `/auth/login?connection=${connection}`);
  await page.getByRole("link", { name: "Create an account to connect your client" }).click();
  assert.equal(new URL(page.url()).searchParams.get("connection"), connection);
  await page.getByRole("link", { name: "Resend verification" }).click();
  assert.equal(new URL(page.url()).searchParams.get("connection"), connection);
  await page.goto(origin + `/auth/signup?connection=${connection}`);
  await page.getByLabel("Username", { exact: true }).fill("new-user");
  await page.getByLabel("Email", { exact: true }).fill("new@example.test"); await page.getByLabel("New password").fill("long-test-password");
  await page.getByRole("button", { name: "Continue" }).click(); await waitText(page, "status", "check your inbox");
  await page.reload(); // Waiting survives refresh, including a verification in a different browser.
  verified = true;
  await page.getByRole("heading", { name: "Authorize My MCP CLI" }).waitFor();
  assert.equal(grants, 0); assert.equal(new URL(page.url()).searchParams.get("state"), "original");
  await page.getByRole("button", { name: "Allow", exact: true }).click(); await page.waitForURL("**/completed?code=grant"); assert.equal(grants, 1);
  await context.close();
});

test("verification automatically signs in and resumes consent, while other-browser verification displays return instructions", async () => {
  for (const crossBrowser of [false, true]) {
    const { page, context } = await pageFor("/auth/verify?token=one-time&connection=attempt");
    let active = false, verifications = 0;
    await page.route("**/api/v1/session", route => route.fulfill({ json: active ? { authenticated: true, user: { id: "owner", email: "new@example.test" }, team: { id: "workspace", role: "owner" }, capabilities: [] } : { authenticated: false } }));
    await page.route("**/api/v1/auth/email-verification/complete", route => { verifications++; active = true; assert.deepEqual(route.request().postDataJSON(), { token: "one-time" }); return route.fulfill({ json: crossBrowser ? { ok: true, crossBrowser: true } : { ok: true, returnTo: "/authorize?client_id=cli&connection=attempt" } }); });
    await page.route("**/api/v1/oauth/consent/preview", route => route.fulfill({ json: { clientName: "MCP CLI", scopes: [], request: "signed", signature: "signature", expiresAt: new Date(Date.now() + 600000).toISOString() } }));
    assert.equal(verifications, 0); await page.getByRole("button", { name: "Verify email" }).click();
    if (crossBrowser) { await waitText(page, "status", "Return to the browser"); assert.equal(new URL(page.url()).pathname, "/auth/verify"); }
    else await page.getByRole("heading", { name: "Authorize MCP CLI" }).waitFor();
    assert.equal(verifications, 1); await context.close();
  }
});

test("profile edits username, reports conflicts, and retains the saved value on reload", async () => {
  const {page,context}=await pageFor("/auth/login");
  let username="profile-owner";
  await page.route("**/api/v1/session",route=>route.fulfill({json:{authenticated:true,user:{id:"u",email:"owner@example.test"},team:{id:"t",name:username,role:"owner"},capabilities:[],expiresAt:"2099-01-01T00:00:00Z"}}));
  await page.route("**/api/v1/profile",route=>{
    if(route.request().method()==="PUT"){
      const next=route.request().postDataJSON().username;
      if(next==="taken")return route.fulfill({status:409,json:{error:{code:"invalid_request",message:"That username is already taken."}}});
      username=next;
    }
    return route.fulfill({json:{username,email:"owner@example.test"}});
  });
  await page.route("**/api/v1/presets",route=>route.fulfill({json:{presets:[]}}));
  await page.goto(origin+"/settings/profile");
  assert.equal(await page.getByRole("navigation",{name:"Main navigation",exact:true}).getByRole("link",{name:"profile-owner",exact:true}).getAttribute("href"),"/");
  await page.getByLabel("Username",{exact:true}).fill("updated-owner");
  await page.getByRole("button",{name:"Save profile"}).click();
  await page.getByRole("status").filter({hasText:"Profile saved"}).waitFor();
  await page.getByRole("navigation",{name:"Main navigation",exact:true}).getByRole("link",{name:"updated-owner",exact:true}).waitFor();
  await page.reload();
  assert.equal(await page.getByLabel("Username",{exact:true}).inputValue(),"updated-owner");
  await page.getByLabel("Username",{exact:true}).fill("taken");
  await page.getByRole("button",{name:"Save profile"}).click();
  await page.getByRole("alert").filter({hasText:"already taken"}).waitFor();
  await page.reload();
  assert.equal(await page.getByLabel("Username",{exact:true}).inputValue(),"updated-owner");
  await page.getByRole("navigation",{name:"Main navigation",exact:true}).getByRole("link",{name:"updated-owner",exact:true}).click();
  await page.getByRole("heading",{name:"Recent work",exact:true}).waitFor();
  await context.close();
});
