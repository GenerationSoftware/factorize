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
  let current = skill;
  await page.route(`**/api/v1/skills/${skill.id}`, async route => {
    if (route.request().method() === "PUT") {
      assert.deepEqual(route.request().postDataJSON(), { key: "review-updated", body: "Updated instructions", expectedRevision: 1 });
      current = { ...skill, key: "review-updated", body: "Updated instructions", revision: 2 };
    }
    return route.fulfill({ json: current });
  });
  await page.goto(origin + "/skills");
  await page.getByRole("link", { name: "review", exact: true }).click();
  await page.getByRole("heading", { name: "review", exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, `/skills/${skill.id}`);
  const editButton = page.getByRole("button", { name: "Edit", exact: true });
  await editButton.waitFor({ state: "visible" });
  assert.equal(await editButton.count(), 1);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Key", { exact: true }).fill("review-updated");
  await page.locator("textarea").fill("Updated instructions");
  await page.getByRole("button", { name: "Save skill", exact: true }).click();
  await page.getByText("Updated instructions", { exact: true }).waitFor();
  await context.close();
});

test("replacing native skills with a GitHub folder requires confirmation", async () => {
  const context = await browser.newContext(), page = await context.newPage();
  try {
    let source = {kind:"managed"};
    const writes = [];
    await page.route("**/api/v1/session", route => route.fulfill({json:{authenticated:true,user:{id:"owner",email:"owner@example.test"},workspace:{id:"workspace",name:"Workspace",role:"owner"},capabilities:["skills:read","skills:write","integrations:write"]}}));
    await page.route("**/api/v1/skills?**", route => route.fulfill({json:{items:[],nextCursor:null}}));
    await page.route("**/api/v1/providers/github/installations", route => route.fulfill({json:[{installationId:7,state:"active",accountLogin:"org"}]}));
    await page.route("**/api/v1/providers/github/installations/7/repositories", route => route.fulfill({json:[{id:42,fullName:"org/agents",defaultBranch:"main"}]}));
    await page.route("**/api/v1/skill-library", route => {
      if (route.request().method() === "PUT") {
        const {confirmOverwrite,...selected} = route.request().postDataJSON();
        writes.push({confirmOverwrite,...selected});
        source = selected;
      }
      return route.fulfill({json:{source,remote:"https://fixture.test/library.git",commit:"aaaa",upstreamCommit:"bbbb",error:null}});
    });
    await page.goto(origin + "/skills");
    await page.getByRole("button", {name:"Change repository"}).click();
    await page.getByLabel("Source of truth").selectOption("github");
    await page.getByRole("combobox", {name:/^Installation/}).selectOption("7");
    await page.getByRole("combobox", {name:/^Repository/}).selectOption("42");
    const save = page.getByRole("button", {name:"Save repository"});
    page.once("dialog", dialog => dialog.dismiss());
    await save.click();
    assert.deepEqual(writes, []);
    page.once("dialog", dialog => {assert.match(dialog.message(), /org\/agents.*main.*skills/); return dialog.accept();});
    await save.click();
    await page.getByRole("button", {name:"Change repository"}).waitFor();
    assert.deepEqual(writes,[{kind:"github",installationId:7,repositoryId:42,branch:"main",folder:"skills",confirmOverwrite:true}]);
  } finally { await context.close(); }
});
