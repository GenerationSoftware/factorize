import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mockApi, runId, run } from "../visual/fixtures.mjs";
let server, origin;
test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://fixture").pathname, file = /^(\/assets\/|\/theme-init.js$)/.test(path) ? path : "/index.html";
    try { const data = await readFile(new URL("../../dist" + file, import.meta.url)); res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".png") ? "image/png" : "text/html"); res.end(data); } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); });
const skillId = "10000000-0000-4000-8000-000000000001";
const skill = { id: skillId, key: "review", description: "Review the release", revision: 1, body: "Review the release", factorize: { disabled: false }, definition: { name: "review", description: "Review the release", markdown: "Review the release", factorize: { disabled: false, concurrency: 0 } } };
async function setup(page) {
  await mockApi(page);
  await page.route("**/api/v1/team", route => route.fulfill({ json: { id: "team", name: "Release", runDefaults: { capacity: 4 } } }));
  await page.route("**/api/v1/presets", route => route.fulfill({ json: { presets: [] } }));
  await page.route("**/api/v1/skills?**", route => route.fulfill({ json: { items: [skill, { ...skill, id: "disabled", key: "paused", factorize: { disabled: true } }], nextCursor: null } }));
  await page.route(`**/api/v1/skills/${skillId}`, route => route.fulfill({ json: skill }));
  await page.route(`**/api/v1/skills/${skillId}/files`, route => route.fulfill({ json: { revision: 1, commit: null, files: [] } }));
  await page.route("**/api/v1/profile", route => route.fulfill({ json: { username: "owner", email: "owner@example.test" } }));
  await page.route("**/api/v1/integrations/phoenix", route => route.fulfill({ json: { configured: false, revision: 0 } }));
}
for (const width of [390, 1280]) {
  test(`skill Run actions launch directly and history stays uncluttered at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await setup(page);
    const submissions = [];
    await page.route("**/api/v1/runs", route => {
      submissions.push(route.request().postDataJSON());
      return submissions.length === 1 ? route.fulfill({ status: 503, json: { error: { message: "Try again" } } }) : route.fulfill({ status: 202, json: { runId, duplicate: false } });
    });
    await page.goto(origin + "/skills");
    const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: "review", exact: true }) });
    await expect(row.getByRole("link", { name: "review", exact: true })).toHaveCSS("text-decoration-line", "none");
    await expect(row.getByRole("cell").last().getByRole("button", { name: "Run review" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Run paused" })).toBeDisabled();
    const nav = page.getByRole("navigation", { name: "Dashboard navigation" }); await expect(nav.getByRole("link", { name: "Skills", exact: true })).toHaveCSS("font-size", "16px");
    await row.getByRole("button", { name: "Run review" }).click(); await expect(row.getByRole("alert")).toHaveText("Try again");
    await row.getByRole("button", { name: "Run review" }).click(); await expect(page).toHaveURL(new RegExp(`/runs/${runId}`));
    expect(submissions[0]).toEqual({ skill: skillId, idempotencyKey: expect.any(String) }); expect(submissions[1]).toEqual(submissions[0]);
    await page.goto(origin + `/skills/${skillId}`); await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible(); await page.getByRole("button", { name: "Run review" }).click(); await expect(page).toHaveURL(new RegExp(`/runs/${runId}`));
    expect(submissions[2].skill).toBe(skillId); expect(submissions[2].idempotencyKey).not.toBe(submissions[0].idempotencyKey);
    for (const path of ["/runs", `/skills/${skillId}/runs`]) {
      await page.goto(origin + path); await expect(page.getByRole("region", { name: "Trigger runs table" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Runs", exact: true })).toHaveCount(0); await expect(page.getByRole("button", { name: "Start run", exact: true })).toHaveCount(0); await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole("navigation", { name: "Skill navigation" }).getByRole("link", { name: "Runs", exact: true })).toHaveCSS("font-size", "16px");
  });
  test(`settings share their subnav and installed integrations use compact columns at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 }); await setup(page);
    for (const path of ["/settings/models", "/settings/models/new", "/settings/vm", "/settings/profile"]) {
      await page.goto(origin + path);
      const nav = page.getByRole("navigation", { name: "Dashboard navigation" }); await expect(nav).toHaveCount(1); await expect(nav.getByRole("link", { name: "Settings", exact: true })).toHaveAttribute("aria-current", "page");
    }
    await page.goto(origin + "/integrations");
    await expect(page.getByRole("heading", { name: "Integrations", exact: true })).toHaveCount(0); await expect(page.getByText("Connect the providers used by your triggers.")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Installed Integrations", exact: true })).toBeVisible();
    const row = page.getByRole("list", { name: "Installed Integrations" }).getByRole("listitem").first(); await expect(row.getByText("Connected", { exact: true })).toBeVisible();
    if (width === 1280) { const name = await row.getByText("Linear", { exact: true }).boundingBox(), detail = await row.getByText("Release workspace", { exact: true }).boundingBox(), status = await row.getByText("Connected", { exact: true }).boundingBox(); expect(detail.x).toBeGreaterThan(name.x); expect(status.x).toBeGreaterThan(detail.x); expect((await row.boundingBox()).height).toBeLessThanOrEqual(80); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await row.getByRole("button", { name: "Actions for Linear" }).click(); await expect(page.getByRole("menuitem", { name: "Reconnect Linear" })).toBeVisible(); await page.keyboard.press("Escape");
    await page.screenshot({ path: testInfo.outputPath(`installed-integrations-${width}.png`), fullPage: true });
  });
}


test("run header shows its parent skill below the run name and links to the skill page", async ({ page }) => {
  await setup(page); await page.emulateMedia({ colorScheme: "dark" });
  let parent = { launch_skill_id: skillId, launch_skill_key: "review" };
  await page.route(`**/api/v1/runs/${runId}/status`, route => route.fulfill({ json: { ...run, trigger_id: null, ...parent } }));
  await page.goto(origin + `/runs/${runId}`);
  const label = page.getByText("SKILL:", { exact: true }), link = page.getByRole("link", { name: "review", exact: true }), runLabel = page.getByText("Run", { exact: true });
  await expect(link).toBeVisible(); await expect(label).toHaveCSS("font-size", "12px");
  expect(await label.evaluate(node => getComputedStyle(node).color)).toBe(await runLabel.evaluate(node => getComputedStyle(node).color));
  expect(await link.evaluate(node => getComputedStyle(node).color)).not.toBe(await label.evaluate(node => getComputedStyle(node).color));
  const title = await page.getByRole("heading", { name: run.run_name, exact: true }).boundingBox();
  expect((await label.boundingBox()).y).toBeGreaterThanOrEqual(title.y + title.height);
  await link.click(); await expect(page).toHaveURL(origin + `/skills/${skillId}`); await expect(page.getByRole("heading", { name: "review", exact: true })).toBeVisible();
  parent = { launch_skill_id: null, launch_skill_key: null }; await page.goto(origin + `/runs/${runId}`); await expect(page.getByRole("heading", { name: run.run_name, exact: true })).toBeVisible(); await expect(label).toHaveCount(0);
});

test("Settings use the common header borders and run pages have no rename UI", async ({ page }) => {
  await setup(page);
  const borders = locator => locator.evaluate(node => {
    const nav = getComputedStyle(node), header = getComputedStyle(node.closest("header"));
    return { top: nav.borderTopWidth, topColor: nav.borderTopColor, bottom: header.borderBottomWidth, bottomColor: header.borderBottomColor, background: header.backgroundColor };
  });
  for (const { width, theme } of [{ width: 390, theme: "dark" }, { width: 1280, theme: "light" }]) {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme: theme }); await page.goto(origin + "/integrations");
    const nav = page.getByRole("banner").getByRole("navigation", { name: "Dashboard navigation" }); await expect(nav).toBeVisible(); const expected = await borders(nav);
    let sidebar;
    for (const path of ["/settings/models", "/settings/models/new", "/settings/vm", "/settings/profile"]) {
      await page.goto(origin + path); await expect(nav).toBeVisible(); await expect(page.getByRole("navigation", { name: "Dashboard navigation" })).toHaveCount(1); expect(await borders(nav)).toEqual(expected);
      const localNav = page.getByRole("navigation", { name: path.endsWith("profile") ? "Settings" : "Team settings", exact: true });
      const current = await localNav.evaluate(node => { const style = getComputedStyle(node); return { width: style.borderBottomWidth, color: style.borderBottomColor }; });
      if (sidebar) expect(current).toEqual(sidebar); else sidebar = current;
    }
  }
  await page.goto(origin + `/runs/${runId}`); await expect(page.getByRole("heading", { name: run.run_name, exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "Switch run", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rename", exact: true })).toHaveCount(0); await expect(page.getByRole("textbox", { name: "Run name", exact: true })).toHaveCount(0);
});
