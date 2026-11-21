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

test("editing model integrations preserves keys unless keyless access is explicitly selected", async ({ page }) => {
  await mockApi(page);
  const id="4dcfb380-67f6-4db4-bd45-3a0bfedc950d", writes=[];
  await page.route("**/api/v1/model-accounts", route=>route.fulfill({json:{revision:3,accounts:[{id,name:"OpenAI",description:null,revision:3,credentialConfigured:true,providerUrl:"https://api.openai.com/v1",contextWindow:128000,maxTokens:8192}]}}));
  await page.route(`**/api/v1/model-accounts/${id}`, async route=>{writes.push(route.request().postDataJSON());await route.fulfill({json:{revision:4,duplicate:false}});});
  await page.goto(origin+"/integrations");
  const edit=async()=>{await page.getByRole("button",{name:"Actions for OpenAI",exact:true}).click();await page.getByRole("menuitem",{name:"Edit model integration"}).click();};
  await edit();
  let dialog=page.getByRole("dialog");
  await expect(dialog.getByLabel("API key (optional)",{exact:true})).toHaveValue("");
  await expect(dialog.getByText("Leave blank to keep the saved API key. Enter a new key to replace it.")).toBeVisible();
  await dialog.getByRole("button",{name:"Save model integration"}).click();
  await expect(dialog).toBeHidden();expect(writes[0]).not.toHaveProperty("apiKey");
  await edit();dialog=page.getByRole("dialog");
  await dialog.getByLabel("Use keyless access (remove saved API key)").check();
  await expect(dialog.getByLabel("API key (optional)",{exact:true})).toBeDisabled();
  await dialog.getByRole("button",{name:"Save model integration"}).click();
  await expect(dialog).toBeHidden();expect(writes[1].apiKey).toBeNull();
});
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

test("Integrations suppresses login autofill and unmounts credential forms across refreshes", async ({ page }) => {
  await page.addInitScript(() => {
    window.credentialRequests = 0;
    if (navigator.credentials) Object.defineProperty(navigator.credentials, "get", { configurable: true, value: () => { window.credentialRequests++; return Promise.reject(new DOMException("Unexpected credential request", "NotAllowedError")); } });
  });
  await page.clock.install(); await mockApi(page);
  let sessionReads = 0;
  await page.route("**/api/v1/session", route => { sessionReads++; return route.fulfill({ json: { authenticated: true, user: { id: "owner", email: "owner@example.test" }, team: { id: "tenant", name: "Release" }, capabilities: [], expiresAt: "2099-01-01T00:00:00Z" } }); });
  await page.route("**/api/v1/integrations/phoenix", route => route.fulfill({ json: { configured: false, revision: 0 } }));
  await page.goto(origin + "/integrations"); await expect(page.getByRole("heading", { name: "Installed Integrations" })).toBeVisible();
  const idle = async () => { await expect(page.locator("form, dialog, input[type=password], input[autocomplete*=webauthn]")).toHaveCount(0); expect(await page.evaluate(() => window.credentialRequests)).toBe(0); };
  await expect(page.locator("body")).toHaveAttribute("data-1p-ignore", "true");
  await expect(page.locator("body")).toHaveAttribute("data-op-ignore", "true");
  await idle(); await page.clock.fastForward(61_000); await expect.poll(() => sessionReads).toBeGreaterThan(1); await idle();
  await page.getByRole("button", { name: "Actions for Linear" }).click(); await page.getByRole("heading", { name: "Installed Integrations" }).click(); await idle();
  for (const name of ["exe.dev", "Amp", "Fly.io", "Bearer API", "Model integration", "Phoenix Cloud telemetry", "Cloudflare Tail", "X"]) {
    await page.getByRole("button", { name: `Add ${name} integration`, exact: true }).click(); const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
    const secret = dialog.locator('input[type="password"]'); await expect(secret).toHaveCount(1); await expect(secret).toHaveAttribute("autocomplete", "off"); await expect(secret).toHaveAttribute("data-1p-ignore", "true"); await expect(secret).toHaveAttribute("data-op-ignore", "true");
    if (name === "Model integration") { await secret.fill("manual-api-key"); await secret.evaluate(node => { node.dataset.identity = "same-secret-input"; }); await page.clock.fastForward(61_000); await expect(secret).toHaveValue("manual-api-key"); await expect(secret).toHaveAttribute("data-identity", "same-secret-input"); }
    await page.keyboard.press("Escape"); await idle();
  }
  await page.getByRole("navigation", { name: "Dashboard navigation" }).getByRole("link", { name: "Runs", exact: true }).click(); await expect(page).toHaveURL(origin + "/runs"); await expect(page.locator("body")).not.toHaveAttribute("data-1p-ignore"); await expect(page.locator("body")).not.toHaveAttribute("data-op-ignore");
  await page.goto(origin + "/auth/login"); await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("autocomplete", "current-password"); await expect(page.getByLabel("Password", { exact: true })).not.toHaveAttribute("data-1p-ignore");
});
