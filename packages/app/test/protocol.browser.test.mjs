import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
let server, origin, browser;
before(async () => { server = createServer(async (req, res) => { const path = new URL(req.url, "http://local").pathname, file = path.startsWith("/assets/") ? path : "/index.html"; try { const body = await readFile(new URL("../dist" + file, import.meta.url)); res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); res.end(body); } catch { res.statusCode = 404; res.end(); } }); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); origin = "http://127.0.0.1:" + server.address().port; browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });
async function setup() { const context = await browser.newContext(), page = await context.newPage(); page.setDefaultTimeout(10000); await page.route("**/api/v1/session", route => route.fulfill({ json: { authenticated: true, user: { id: "owner", email: "owner@example.test" }, workspace: { id: "tenant", name: "Workspace" }, capabilities: [], expiresAt: "2026-10-10T00:00:00Z" } })); return { context, page }; }
test("consent refresh preserves OAuth query, scope selection and server-owned redirect", async () => {
  const { context, page } = await setup(); const previews = []; let decision;
  await page.route("**/api/v1/oauth/consent/preview", route => { previews.push(route.request().postDataJSON()); return route.fulfill({ json: { clientName: "External CLI", scopes: ["flows:read", "runs:write"], request: "signed-request", signature: "signature", expiresAt: "2026-10-09T12:00:00Z" } }); });
  await page.route("**/api/v1/oauth/consent/decision", route => { decision = route.request().postDataJSON(); return route.fulfill({ json: { redirectTo: origin + "/completed?code=issued" } }); });
  await page.goto(origin + "/authorize?client_id=client&state=original&code_challenge=challenge"); await page.getByRole("heading", { name: "Authorize External CLI" }).waitFor(); await page.reload(); await page.getByLabel("runs:write").uncheck(); await page.getByRole("button", { name: "Allow", exact: true }).click(); await page.waitForURL("**/completed?code=issued");
  assert.equal(previews.at(-1).authorizationQuery, "client_id=client&state=original&code_challenge=challenge"); assert.deepEqual(decision, { request: "signed-request", signature: "signature", decision: "allow", scopes: ["flows:read"] }); await context.close();
});
test("device deep link loads metadata and approval sends no protocol tokens", async () => {
  const { context, page } = await setup(); let decision;
  await page.route("**/api/v1/oauth/device/preview", route => route.fulfill({ json: { userCode: "ABCD-EFGH", clientName: "My CLI", scopes: ["flows:read"], expiresAt: "2026-10-09T12:00:00Z" } }));
  await page.route("**/api/v1/oauth/device/decision", route => { decision = route.request().postDataJSON(); return route.fulfill({ json: { status: "approved" } }); });
  await page.goto(origin + "/device?user_code=ABCD-EFGH"); await page.getByRole("heading", { name: "Authorize My CLI" }).waitFor(); await page.reload(); await page.getByRole("button", { name: "Allow device" }).click(); await page.getByRole("status").filter({ hasText: "Device connected" }).waitFor(); assert.deepEqual(decision, { userCode: "ABCD-EFGH", decision: "allow" }); await context.close();
});
test("expired device authorization is a safe visible error", async () => {
  const { context, page } = await setup(); await page.route("**/api/v1/oauth/device/preview", route => route.fulfill({ status: 400, json: { error: { code: "invalid_request", message: "Invalid or expired device code." } } })); await page.goto(origin + "/device?user_code=EXPIRED"); await page.getByRole("alert").filter({ hasText: "Invalid or expired device code." }).waitFor(); assert.equal(await page.getByRole("button", { name: "Allow device" }).count(), 0); await context.close();
});
