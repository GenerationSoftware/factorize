import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mockApi } from "../visual/fixtures.mjs";
let server, origin;
test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://fixture").pathname;
    const file = /^(\/assets\/|\/theme-init.js$)/.test(path) ? path : "/index.html";
    try { const body = await readFile(new URL("../../dist" + file, import.meta.url)); res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".png") ? "image/png" : "text/html"); res.end(body); } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); });
const withinViewport = async locator => {
  const box = await locator.boundingBox(), viewport = await locator.page().evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width); expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
};
test("Phoenix installs through the compact provider list and joins connected integrations", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 }); await mockApi(page);
  let config = { configured: false, endpoint: "", projectName: "factorize", projectId: null, credentialConfigured: false, enabled: false, revision: 0, lastTestAt: null, lastError: null };
  await page.route("**/api/v1/integrations/phoenix", async route => {
    if (route.request().method() === "PUT") { const body = route.request().postDataJSON(); expect(body.apiKey).toBe("private-phoenix-key"); config = { ...config, ...body, apiKey: undefined, configured: true, credentialConfigured: true, revision: 1 }; }
    if (route.request().method() === "DELETE") config = { ...config, configured: false };
    return route.fulfill({ json: config });
  });
  await page.goto(origin + "/integrations");
  const providers = page.getByLabel("Available integration providers");
  const linear = providers.getByRole("link", { name: "Add Linear integration" }), phoenix = providers.getByRole("button", { name: "Add Phoenix Cloud telemetry integration" });
  expect((await linear.boundingBox()).width).toBe((await phoenix.boundingBox()).width);
  await page.screenshot({ path: testInfo.outputPath("available-integrations-mobile.png") });
  await phoenix.click(); const dialog = page.getByRole("dialog", { name: "Add Phoenix integration" });
  await dialog.getByLabel("Phoenix base URL").fill("https://phoenix.example/space"); await dialog.getByLabel("Phoenix project").fill("team-runs"); await dialog.getByLabel("Phoenix API key").fill("private-phoenix-key");
  await dialog.getByRole("button", { name: "Save Phoenix settings" }).click(); await expect(dialog).toBeHidden();
  const row = page.getByRole("list", { name: "Installed Integrations" }).getByRole("listitem").filter({ hasText: "Phoenix Cloud telemetry" }); await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Actions for Phoenix Cloud telemetry" }).click(); await expect(page.getByRole("menuitem", { name: "Test connection" })).toBeVisible(); await withinViewport(page.getByRole("menu"));
  await page.getByRole("heading", { name: "Installed Integrations", exact: true }).click(); await expect(page.getByRole("menu")).toBeHidden();
  await expect(page.getByText("private-phoenix-key")).toHaveCount(0);
});
test("all preset menus close outside, stay on mobile screens and editor selects use styled options", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 }); await mockApi(page);
  const presets = ["vm", "permission", "model"].map((kind, index) => ({ id: `00000000-0000-4000-8000-00000000000${index}`, kind, slug: "team-default", name: `${kind} default`, revision: 1, isDefault: true, settings: kind === "vm" ? { provider: "none" } : kind === "model" ? { model: "test-model", effort: "high" } : { runScopes: [] } }));
  await page.route("**/api/v1/presets", route => route.fulfill({ json: { presets } }));
  await page.route("**/api/v1/team", route => route.fulfill({ json: { runDefaults: { capacity: 4 } } }));
  for (const section of ["vm", "permissions", "models"]) {
    await page.goto(origin + `/settings/${section}`); const trigger = page.getByRole("button", { name: /^Actions for/ }); await trigger.click();
    const menu = page.getByRole("menu"); await expect(menu).toBeVisible(); await withinViewport(menu); await expect(page.getByRole("menuitem", { name: "Delete", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape"); await expect(menu).toBeHidden(); await expect(trigger).toBeFocused();
    await trigger.click(); await page.getByRole("heading", { name: /presets$/ }).click(); await expect(menu).toBeHidden();
  }
  await page.goto(origin + "/settings/vm/new"); const provider = page.getByRole("combobox", { name: "Execution provider" }); await provider.click();
  await expect(page.getByRole("option", { name: "exe.dev", exact: true })).toBeVisible(); await withinViewport(page.getByRole("listbox")); await page.getByRole("option", { name: "exe.dev", exact: true }).click(); await expect(provider).toHaveText(/exe.dev/); await expect(page.getByRole("combobox", { name: "Connection", exact: true })).toBeVisible();
});
test("Code offers readable HTTPS URLs, scoped credentials and the correct GitHub source", async ({ page, context }, testInfo) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]); await page.setViewportSize({ width: 390, height: 600 }); await mockApi(page);
  await page.route("**/api/v1/skills?**", route => route.fulfill({ json: { items: [], nextCursor: null } })); await page.route("**/api/v1/presets", route => route.fulfill({ json: { presets: [] } }));
  let source = "managed";
  await page.route("**/api/v1/skill-library/clone", route => route.fulfill({ json: { source, url: source === "managed" ? "https://git.factorize.sh/acme/skills.git" : "https://github.com/acme/skills.git", writable: source === "managed", branch: "main", folder: "skills" } }));
  await page.route("**/api/v1/skill-library/git-token", route => route.fulfill({ json: { username: "git", token: "fgit_private-fixture", expiresAt: "2099-01-01T12:00:00Z" } }));
  await page.goto(origin + "/skills"); await page.getByRole("button", { name: "Code", exact: true }).click(); const dialog = page.getByRole("dialog", { name: "Clone skills repository" }); await expect(dialog).toBeVisible(); await withinViewport(dialog);
  await page.screenshot({ path: testInfo.outputPath("code-menu-mobile.png") });
  await expect(dialog.getByLabel("Repository URL")).toHaveValue("https://git.factorize.sh/acme/skills.git"); await dialog.getByRole("button", { name: "Copy clone URL" }).click(); expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("https://git.factorize.sh/acme/skills.git");
  await dialog.getByRole("button", { name: "Get Git token" }).click(); await expect(dialog.getByLabel("Git token", { exact: true })).toHaveValue("fgit_private-fixture"); await dialog.getByRole("button", { name: "Copy Git token" }).click(); expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("fgit_private-fixture");
  await page.keyboard.press("Escape"); await expect(dialog).toBeHidden(); await page.getByRole("button", { name: "Code", exact: true }).click(); await expect(dialog.getByLabel("Git token", { exact: true })).toHaveCount(0); await dialog.getByRole("link", { name: "Skill settings" }).click(); await expect(page).toHaveURL(origin + "/settings/skills");
  source = "github"; await page.goto(origin + "/skills"); await page.getByRole("button", { name: "Code", exact: true }).click(); await expect(dialog.getByLabel("Repository URL")).toHaveValue("https://github.com/acme/skills.git"); await expect(dialog.getByRole("button", { name: "Get Git token" })).toHaveCount(0);
});

test("skills settings use personal Git tokens only for Factorize repositories and hide the internal remote", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]); await mockApi(page);
  let source = { kind: "managed" }, tokenRequests = 0, legacyRequests = 0;
  await page.route("**/api/v1/skill-library", route => route.fulfill({ json: { source, remote: "https://private.artifacts.cloudflare.net/internal-repo.git", commit: "a".repeat(40), upstreamCommit: null, error: null } }));
  await page.route("**/api/v1/skill-library/token", route => { legacyRequests++; return route.fulfill({ status: 500 }); });
  await page.route("**/api/v1/skill-library/git-token", route => { tokenRequests++; return route.fulfill({ json: { username: "git", token: "fgit_settings-fixture", expiresAt: "2099-01-01T12:00:00Z" } }); });
  await page.goto(origin + "/settings/skills");
  await expect(page.getByText("Factorize remote", { exact: true })).toHaveCount(0); await expect(page.getByText(/Store each skill in/)).toHaveCount(0); await expect(page.locator('input[value*="artifacts.cloudflare.net"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Get Git Token", exact: true }).click(); await expect(page.getByLabel("Git token", { exact: true })).toHaveValue("fgit_settings-fixture"); await expect(page.getByLabel("Git token", { exact: true })).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Copy Git token" }).click(); expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("fgit_settings-fixture");
  await page.getByRole("button", { name: "Change repository" }).click(); await expect(page.getByLabel("Git token", { exact: true })).toHaveCount(0); await page.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(page.getByRole("button", { name: "Get Git Token", exact: true })).toBeVisible();
  source = { kind: "github", installationId: 17, repositoryId: 42, branch: "main", folder: "skills" }; await page.reload();
  await expect(page.getByText("Auth with Github", { exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "Get Git Token", exact: true })).toHaveCount(0); await expect(page.getByLabel("Git token", { exact: true })).toHaveCount(0);
  expect(tokenRequests).toBe(1); expect(legacyRequests).toBe(0);
});

test("integration add and action controls align left at the same size on desktop and mobile", async ({ page }, testInfo) => {
  await mockApi(page); await page.route("**/api/v1/integrations/phoenix", route => route.fulfill({ json: { configured: false, revision: 0 } }));
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 }); await page.goto(origin + "/integrations");
    const row = page.getByRole("list", { name: "Installed Integrations" }).getByRole("listitem").first(), actions = row.getByRole("button", { name: "Actions for Linear" });
    const providers = page.getByRole("list", { name: "Available integration providers" }), add = providers.getByRole("link", { name: "Add Linear integration" });
    await expect(actions).toBeVisible(); await expect(add).toBeVisible();
    const actionBox = await actions.boundingBox(), addBox = await add.boundingBox();
    expect(actionBox.width).toBe(40); expect(actionBox.height).toBe(40); expect(addBox.width).toBe(actionBox.width); expect(addBox.height).toBe(actionBox.height); expect(addBox.x).toBe(actionBox.x);
    expect(actionBox.x + actionBox.width).toBeLessThan((await row.getByText("Linear", { exact: true }).boundingBox()).x);
    expect(addBox.x + addBox.width).toBeLessThan((await providers.getByText("Linear", { exact: true }).boundingBox()).x);
    await actions.click(); await expect(page.getByRole("menuitem", { name: "Reconnect Linear" })).toBeVisible(); await withinViewport(page.getByRole("menu")); await page.keyboard.press("Escape");
    await providers.getByRole("button", { name: "Add Phoenix Cloud telemetry integration" }).click(); await expect(page.getByRole("dialog", { name: "Add Phoenix integration" })).toBeVisible(); await page.keyboard.press("Escape");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`left-integration-controls-${width}.png`) });
  }
});
