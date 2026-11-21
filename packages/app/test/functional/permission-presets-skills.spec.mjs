import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mockApi } from "../visual/fixtures.mjs";
let server, origin;
test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://fixture").pathname, file = /^(\/assets\/|\/theme-init.js$)/.test(path) ? path : "/index.html";
    try { const data = await readFile(new URL("../../dist" + file, import.meta.url)); res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".png") ? "image/png" : "text/html"); res.end(data); } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); });
for (const width of [390, 1280]) test(`simplified Skills, preserved integration defaults and permission preset editing at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 }); await mockApi(page);
  const id = "10000000-0000-4000-8000-000000000001", integrationId = "10000000-0000-4000-8000-000000000002", triggerId = "10000000-0000-4000-8000-000000000003";
  const requests = []; page.on("request", req => requests.push(new URL(req.url()).pathname));
  await page.route("**/api/v1/skills?**", route => route.fulfill({ json: { items: [{ id, key: "release-review", description: "Review releases, summarize changes, and check compatibility across all supported applications.", factorize: { disabled: false } }], nextCursor: null } }));
  await page.goto(origin + "/skills"); const table = page.getByRole("table", { name: "Skills" }); await expect(table.getByRole("link", { name: "release-review" })).toBeVisible();
  expect(await table.getByRole("columnheader").allTextContents()).toEqual(["Skill name", "Description", "Actions"]); await expect(table.getByRole("button", { name: "Run release-review" })).toBeVisible();
  expect(requests).not.toContain("/api/v1/presets"); if (width === 1280) { const cells = table.getByRole("row").nth(1).getByRole("cell"); expect((await cells.nth(1).boundingBox()).width).toBeGreaterThan((await cells.nth(0).boundingBox()).width * 2); }
  await page.screenshot({ path: testInfo.outputPath(`skills-${width}.png`) });
  let policies = [{ id: integrationId, credentialId: "linear", kind: "linear", name: "Linear", available: true, revision: 1, policy: "requestable", requiredScope: "integrations:read" }];
  await page.route("**/api/v1/integration-api-policies", route => route.fulfill({ json: { integrations: policies } }));
  let policyWrite;
  await page.route("**/api/v1/integration-api-policies/*", route => { policyWrite = route.request().postDataJSON(); policies = policies.map(row => ({ ...row, policy: policyWrite.policy, revision: 2 })); return route.fulfill({ json: { integrations: policies } }); });
  await page.route("**/api/v1/integrations/phoenix", route => route.fulfill({ json: { configured: false, revision: 0 } }));
  await page.goto(origin + "/integrations"); const checkbox = page.getByRole("checkbox", { name: "Linear available by default" }); await checkbox.check(); await expect(checkbox).toBeChecked(); expect(policyWrite).toEqual({ policy: "baseline", expectedRevision: 1 });
  let preset = { id, kind: "permission", name: "Release access", slug: "release-access", isDefault: true, revision: 1, settings: { runScopes: ["skills:read"], portableIntegrationIds: [], githubInstallationIds: [], linearConnectionId: null, xConnectionIds: [], allowedTriggerIds: [] } };
  await page.route("**/api/v1/presets", route => route.fulfill({ json: { presets: [preset] } }));
  let saved;
  await page.route(`**/api/v1/presets/${id}`, route => { saved = route.request().postDataJSON(); preset = { ...preset, ...saved, revision: 2 }; return route.fulfill({ json: { preset } }); });
  await page.route("**/api/v1/github-installations", route => route.fulfill({ json: [{ installationId: 17, accountLogin: "release-team", state: "active" }] }));
  await page.route("**/api/v1/integrations/bearer", route => route.fulfill({ json: { revision: 1, integrations: [{ id: integrationId, name: "Docs API", origin: "https://docs.example.test", revision: 1 }] } }));
  await page.route("**/api/v1/trigger-selector?**", route => route.fulfill({ json: { items: [{ id: triggerId, name: "Publish release notes" }], nextCursor: null } }));
  await page.goto(origin + `/settings/permissions/${id}/edit`);
  await expect(page.getByRole("region", { name: "Application permissions", exact: true })).toBeVisible(); await expect(page.getByRole("region", { name: "Integration access", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Run scope skills:read", exact: true })).toBeChecked(); await page.getByRole("checkbox", { name: "Run scope runs:invoke", exact: true }).check();
  await page.getByRole("checkbox", { name: "Docs API", exact: true }).check(); await page.getByRole("checkbox", { name: "GitHub · release-team", exact: true }).check(); await page.getByRole("checkbox", { name: "Publish release notes", exact: true }).check();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: testInfo.outputPath(`permission-preset-${width}.png`), fullPage: true });
  await page.getByRole("button", { name: "Save preset", exact: true }).click(); await expect(page).toHaveURL(origin + "/settings/permissions"); expect(saved.expectedRevision).toBe(1); expect(saved.settings).toMatchObject({ runScopes: ["skills:read", "runs:invoke"], portableIntegrationIds: [integrationId], githubInstallationIds: [17], allowedTriggerIds: [triggerId] });
  await page.getByRole("button", { name: "Actions for Release access" }).click(); await page.getByRole("menuitem", { name: "Edit", exact: true }).click(); await expect(page.getByRole("checkbox", { name: "Docs API", exact: true })).toBeChecked(); await expect(page.getByRole("checkbox", { name: "Publish release notes", exact: true })).toBeChecked();
});
