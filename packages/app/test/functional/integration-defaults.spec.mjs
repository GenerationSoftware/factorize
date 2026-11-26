import { expect } from "@playwright/test";
import { test } from "./fixtures.mjs";

test("installed integrations distinguish instances and save defaults independently on mobile", async ({ page, origin }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/v1/session", route => route.fulfill({ json: {
    authenticated: true, user: { id: "owner", email: "owner@example.test" },
    team: { id: "workspace", name: "Workspace", role: "owner" }, capabilities: [],
  } }));
  await page.route("**/api/v1/integrations", route => route.fulfill({ json: {
    linear: null, clickup: null, exeConnections: [{ connectionId: "test-exe-account" }], ampConnections: [], cloudflareTail: { installations: [] },
  } }));
  await page.route("**/api/v1/providers/github/installations", route => route.fulfill({ json: [101,102,103].map(installationId => ({
    installationId, accountLogin: "same-org", accountType: "Organization", state: installationId === 103 ? "suspended" : "active",
  })) }));
  await page.route("**/api/v1/fly/connection", route => route.fulfill({ json: { connection: null } }));
  await page.route("**/api/v1/integrations/bearer", route => route.fulfill({ json: { integrations: [], revision: 0 } }));
  await page.route("**/api/v1/x/connections", route => route.fulfill({ json: { connections: [] } }));
  await page.route("**/api/v1/integrations/cloudflare", route => route.fulfill({ json: { configured: true, connections: [] } }));

  const rows = [101,102,103].map(id => {
    const integrationId = `00000000-0000-4000-8000-000000000${id}`;
    return { scope: `integration:${integrationId}:1`, integrationId, credentialId: String(id), kind: "github", name: "same-org", available: id !== 103, isDefault: false, preferenceSet: true };
  });
  let releaseFirst;
  const firstResponse = new Promise(resolve => { releaseFirst = resolve; });
  let failSecond = true;
  const writes = [];
  await page.route("**/api/v1/team-permissions", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: rows });
    const body = route.request().postDataJSON();
    writes.push(body);
    const row = rows.find(row => row.scope === body.scope);
    if (row === rows[0]) await firstResponse;
    if (row === rows[1] && failSecond) {
      failSecond = false;
      return route.fulfill({ status: 409, json: { error: { code: "conflict", message: "Could not save this default" } } });
    }
    row.isDefault = body.isDefault;
    return route.fulfill({ json: { ok: true } });
  });

  try {
    const preferences = page.waitForResponse(response => response.url().endsWith("/api/v1/team-permissions") && response.request().method() === "GET");
    await page.goto(origin + "/integrations");
    expect((await preferences).status()).toBe(200);
    const table = page.getByRole("table", { name: "Installed integrations" });
    const forInstallation = id => table.getByRole("row").filter({ hasText: `#${id}` });
    const firstRow = forInstallation(101), secondRow = forInstallation(102), unavailable = forInstallation(103);
    const alpha = firstRow.getByRole("checkbox"), beta = secondRow.getByRole("checkbox");
    await expect(table.getByRole("columnheader")).toHaveText(["Integration", "Available by Default"]);
    await expect(firstRow.getByText("GitHub", { exact: true })).toBeVisible();
    await expect(firstRow.getByText("same-org · Organization · #101", { exact: true })).toBeVisible();
    const availableGitHub = page.getByRole("list", { name: "Available integration providers" })
      .getByRole("listitem").filter({ has: page.getByRole("link", { name: "Add GitHub integration" }) });
    const typography = locator => locator.evaluate(element => {
      const style = getComputedStyle(element);
      return { fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight, color: style.color };
    });
    const availableTitle = await typography(availableGitHub.getByText("GitHub", { exact: true }));
    const installedTitle = await typography(firstRow.getByText("GitHub", { exact: true }));
    const installedSubtitle = await typography(firstRow.getByText(/same-org.*#101/));
    const availableSubtitle = await typography(availableGitHub.getByText("Connect repositories and pull requests.", { exact: true }));
    expect(availableTitle).toMatchObject({ fontSize: "16px", fontWeight: "600" });
    expect(installedTitle).toEqual(availableTitle);
    expect(installedSubtitle).toMatchObject({ fontSize: "14px", fontWeight: "400" });
    expect(availableSubtitle).toEqual(installedSubtitle);
    await expect(table.getByRole("row").filter({ hasText: "test-exe-account" }).getByText("exe.dev", { exact: true })).toBeVisible();
    await expect(unavailable.getByText("Needs attention · suspended")).toBeVisible();
    await expect(unavailable.getByRole("checkbox")).toBeDisabled();
    await expect(table.getByText("Connected", { exact: true })).toHaveCount(0);
    expect(await table.evaluate(element => {
      const shell = element.parentElement;
      return shell.scrollWidth <= shell.clientWidth && document.documentElement.scrollWidth <= window.innerWidth;
    })).toBe(true);

    await firstRow.getByRole("button", { name: /Actions for GitHub/ }).click();
    await expect(page.getByRole("menuitem", { name: "Manage on GitHub" })).toBeVisible();
    await page.keyboard.press("Escape");
    await alpha.check();
    await expect(alpha).toBeDisabled();
    await expect(beta).toBeEnabled();
    await beta.click();
    await expect(secondRow.getByRole("alert")).toHaveText("Could not save this default");
    await expect(beta).not.toBeChecked();
    await expect(alpha).toBeChecked();
    await expect(firstRow.getByRole("alert")).toHaveCount(0);
    await beta.check();
    await expect(beta).toBeEnabled();
    await expect(beta).toBeChecked();
    releaseFirst();
    await expect(alpha).toBeEnabled();
    await expect(alpha).toBeChecked();
    expect(writes).toEqual([rows[0],rows[1],rows[1]].map(({ scope }) => ({ scope, isDefault: true })));
  } finally { releaseFirst(); }
});
