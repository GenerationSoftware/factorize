import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

// Serve the compiled app, not implementation source strings. API behavior is
// mocked at the network boundary here; PostgreSQL suites cover actual auth.
let server, origin, browser;
before(async () => {
  server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://local.test").pathname;
    const file = (/^(\/assets\/|\/theme-init.js$|\/bee-mark-monochrome.png$|\/favicon.ico$)/.test(path)) ? path : "/index.html";
    try {
      const data = await readFile(new URL("../dist" + file, import.meta.url));
      response.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
      response.end(data);
    } catch { response.statusCode = 404; response.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
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
  await page.getByLabel("Email", { exact: true }).fill("owner@example.test");
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
    if (path === "/auth/signup") await page.getByLabel("New password", { exact: true }).fill("long-test-password");
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
  await page.getByLabel("Email", { exact: true }).focus();
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

test("logout refreshes session identity and removes the account display", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  let active = true;
  await page.route("**/api/v1/session", route => route.fulfill({ json: active ? {
    authenticated: true, user: { id: "owner-a", email: "owner@example.test" },
    workspace: { id: "workspace-a", name: "Workspace", role: "owner" },
    capabilities: ["flows:read"], expiresAt: new Date(Date.now() + 3600_000).toISOString(),
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
  await page.route("**/api/v1/session", route => route.fulfill({ json: active ? { authenticated: true, user: { id: "owner", email: "new@example.test" }, workspace: { id: "workspace", role: "owner" }, capabilities: [] } : { authenticated: false } }));
  await page.route("**/api/v1/auth/connections/resume", route => {
    assert.equal(route.request().postDataJSON().connection, connection);
    if (verified) active = true;
    return route.fulfill({ json: verified ? { ok: true, returnTo } : { ok: true, pending: true, clientName: "My MCP CLI" } });
  });
  await page.route("**/api/v1/auth/signup", route => { assert.deepEqual(route.request().postDataJSON(), { email: "new@example.test", password: "long-test-password", connection }); return route.fulfill({ status: 202, json: { ok: true } }); });
  await page.route("**/api/v1/oauth/consent/preview", route => route.fulfill({ json: { clientName: "My MCP CLI", scopes: ["flows:read"], request: "signed", signature: "signature", expiresAt: new Date(Date.now() + 600000).toISOString() } }));
  await page.route("**/api/v1/oauth/consent/decision", route => { grants++; assert.equal(route.request().postDataJSON().decision, "allow"); return route.fulfill({ json: { redirectTo: origin + "/completed?code=grant" } }); });
  await page.goto(origin + `/auth/login?connection=${connection}`);
  await page.getByRole("link", { name: "Create an account to connect your client" }).click();
  assert.equal(new URL(page.url()).searchParams.get("connection"), connection);
  await page.getByRole("link", { name: "Resend verification" }).click();
  assert.equal(new URL(page.url()).searchParams.get("connection"), connection);
  await page.goto(origin + `/auth/signup?connection=${connection}`);
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
    await page.route("**/api/v1/session", route => route.fulfill({ json: active ? { authenticated: true, user: { id: "owner", email: "new@example.test" }, workspace: { id: "workspace", role: "owner" }, capabilities: [] } : { authenticated: false } }));
    await page.route("**/api/v1/auth/email-verification/complete", route => { verifications++; active = true; assert.deepEqual(route.request().postDataJSON(), { token: "one-time" }); return route.fulfill({ json: crossBrowser ? { ok: true, crossBrowser: true } : { ok: true, returnTo: "/authorize?client_id=cli&connection=attempt" } }); });
    await page.route("**/api/v1/oauth/consent/preview", route => route.fulfill({ json: { clientName: "MCP CLI", scopes: [], request: "signed", signature: "signature", expiresAt: new Date(Date.now() + 600000).toISOString() } }));
    assert.equal(verifications, 0); await page.getByRole("button", { name: "Verify email" }).click();
    if (crossBrowser) { await waitText(page, "status", "Return to the browser"); assert.equal(new URL(page.url()).pathname, "/auth/verify"); }
    else await page.getByRole("heading", { name: "Authorize MCP CLI" }).waitFor();
    assert.equal(verifications, 1); await context.close();
  }
});
