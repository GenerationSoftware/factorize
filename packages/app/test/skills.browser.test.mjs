import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

let server, origin, browser;
const skill = { id: "f5fda9d7-aef9-401c-ac95-e2d2f4fc559d", key: "review", body: "Review carefully", revision: 1, usageCount: 2, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
before(async () => { server = createServer(async (request, response) => { const path = new URL(request.url, "http://local.test").pathname; const file = (/^(\/assets\/|\/theme-init.js$|\/bee-mark-monochrome.png$|\/favicon.ico$)/.test(path)) ? path : "/index.html"; try { const data = await readFile(new URL("../dist" + file, import.meta.url)); response.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); response.end(data); } catch { response.statusCode = 404; response.end(); } }); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); origin = "http://127.0.0.1:" + server.address().port; browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });

test("skills link to detail pages and edit from the detail page", async () => {
  const context = await browser.newContext(), page = await context.newPage();
  await page.route("**/api/v1/session", route => route.fulfill({ json: { authenticated: true, user: { id: "owner", email: "owner@example.test" }, workspace: { id: "workspace", name: "Workspace", role: "owner" }, capabilities: ["skills:read", "skills:write"] } }));
  await page.route("**/api/v1/skills**", route => route.fulfill({ json: { items: [{ ...skill, body: undefined }], nextCursor: null } }));
  await page.route(`**/api/v1/skills/${skill.id}`, async route => { if (route.request().method() === "PUT") { assert.deepEqual(route.request().postDataJSON(), { key: "review-updated", body: "Updated instructions", expectedRevision: 1 }); return route.fulfill({ json: { ...skill, key: "review-updated", body: "Updated instructions", revision: 2 } }); } return route.fulfill({ json: skill }); });
  await page.goto(origin + "/skills");
  await page.getByRole("link", { name: "review", exact: true }).click();
  await page.getByRole("heading", { name: "review", exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, `/skills/${skill.id}`);
  assert.equal(await page.getByRole("button", { name: "Edit", exact: true }).count(), 1);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Key", { exact: true }).fill("review-updated");
  await page.locator("textarea").fill("Updated instructions");
  await page.getByRole("button", { name: "Save skill", exact: true }).click();
  await page.getByText("Updated instructions", { exact: true }).waitFor();
  await context.close();
});
