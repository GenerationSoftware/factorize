import { expect } from "@playwright/test";
import { test } from "./fixtures.mjs";

test("saving client permissions keeps a blocked integration unchecked until explicitly selected", async ({ page, origin }) => {
  const integrationId = "18a2410e-ea09-4fe0-af8a-719c0c91e6e2";
  const integrationScope = `integration:${integrationId}:1`;
  const initialScopes = ["team:read", "proxy:use"];
  const editedScopes = ["team:read", "team:write", "proxy:use"];
  let revision = 1;
  let scopes = initialScopes;
  const edits = [];
  await page.route("**/api/v1/session", route => route.fulfill({ json: {
    authenticated: true, user: { id: "owner", email: "owner@example.test" },
    team: { id: "workspace", name: "Workspace", role: "owner" }, capabilities: [],
  } }));
  await page.route("**/api/v1/access/authorized-clients", route => route.fulfill({ json: [{
    grantId: "fixture-grant", clientId: "fixture-client", clientName: "Fixture client", ownerUsername: "owner-user",
    availableScopes: [...editedScopes, integrationScope], scopes, revision,
    scopeLabels: { [integrationScope]: "Linear integration access" },
    credentialScopes: initialScopes, pendingScopes: scopes.filter(scope => !initialScopes.includes(scope)),
    authorizationDate: "2026-10-09T12:00:00Z", expiresAt: null, lastUsedAt: null,
  }] }));
  await page.route("**/api/v1/access/authorizations/fixture-grant/permissions", route => {
    const edit = route.request().postDataJSON();
    edits.push(edit);
    revision++;
    scopes = edit.scopes;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto(origin + "/clients/fixture-grant");
  const editButton = page.getByRole("button", { name: "Edit permissions" });
  const integration = page.getByRole("checkbox", { name: "Linear integration access" });
  const save = async () => {
    await page.getByRole("button", { name: "Save permissions" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  };
  await editButton.click();
  await expect(integration).not.toBeChecked();
  await save();
  expect(edits.at(-1)).toEqual({ scopes: initialScopes, expectedRevision: 1 });

  await page.reload();
  await editButton.click();
  await expect(integration).not.toBeChecked();
  await page.getByRole("checkbox", { name: "team:write", exact: true }).check();
  await save();
  expect(edits.at(-1)).toEqual({ scopes: [...initialScopes, "team:write"], expectedRevision: 2 });

  await page.reload();
  await editButton.click();
  await expect(integration).not.toBeChecked();
  await integration.check();
  await save();
  expect(edits.at(-1)).toEqual({
    scopes: [...editedScopes, integrationScope], expectedRevision: 3,
  });
  await expect(page.getByRole("status").filter({ hasText: "not active" })).toBeVisible();
});


test("shows owner and dates in the Clients list and manages the connection on its detail page", async ({ page, origin }) => {
  const grant = { grantId: "primary", clientId: "same-app", clientName: "Release assistant", appName: "Registered app", ownerUsername: "brendan",
    availableScopes: ["team:read"], scopes: ["team:read"], revision: 0, scopeLabels: {}, integrationOverrides: {},
    authorizationDate: "2026-10-09T12:00:00Z", expiresAt: "2026-12-10T18:30:00Z", lastUsedAt: null };
  const writes = [];
  await page.route("**/api/v1/session", route => route.fulfill({ json: {
    authenticated: true, user: { id: "owner", email: "different-name@example.test" },
    team: { id: "workspace", name: "Workspace", role: "owner" }, capabilities: [],
  } }));
  await page.route("**/api/v1/access/authorized-clients", route => route.fulfill({ json: [grant,
    { ...grant, grantId: "sibling", clientName: "Other connection", expiresAt: null }] }));
  await page.route("**/api/v1/access/authorizations/primary/name", route => {
    expect(route.request().method()).toBe("PUT");
    const body = route.request().postDataJSON();
    writes.push(body);
    grant.clientName = body.name;
    return route.fulfill({ json: body });
  });

  await page.goto(origin + "/clients");
  const main = page.getByRole("main");
  const table = main.getByRole("table", { name: "MCP connections" });
  await expect(table.getByRole("columnheader")).toHaveText(["Username", "Connection", "App", "Authorized", "Expires"]);
  const row = table.getByRole("row").filter({ has: page.getByRole("link", { name: "Release assistant" }) });
  await expect(row.getByRole("cell").first()).toHaveText("brendan");
  await expect(row.getByRole("cell", { name: "Registered app" })).toBeVisible();
  await expect(row.locator("time").first()).toHaveAttribute("datetime", grant.authorizationDate);
  await expect(row.locator("time").last()).toHaveAttribute("datetime", grant.expiresAt);
  await expect(table.getByRole("button")).toHaveCount(0);
  await expect(table.getByRole("cell", { name: "No expiration" })).toBeVisible();

  await row.getByRole("link", { name: "Release assistant" }).click();
  await expect(page).toHaveURL(origin + "/clients/primary");
  await expect(main.getByRole("heading", { level: 1, name: "Release assistant", exact: true })).toBeVisible();
  await expect(main.getByRole("link", { name: "Clients", exact: true })).toHaveCount(0);
  await expect(main.locator("dt")).toHaveText(["Username", "Client", "Authorized", "Expires"]);
  await expect(main.locator("dd").nth(0)).toHaveText("brendan");
  await expect(main.locator("dd").nth(1)).toHaveText("Registered app");
  await expect(main.locator("dd").nth(2).locator("time")).toHaveAttribute("datetime", grant.authorizationDate);
  await expect(main.locator("dd").nth(3).locator("time")).toHaveAttribute("datetime", grant.expiresAt);
  await expect(main.getByRole("button", { name: "Edit permissions" })).toBeVisible();
  await expect(main.getByRole("button", { name: "Revoke connection" })).toBeVisible();

  await main.getByRole("button", { name: "Rename connection" }).click();
  const name = page.getByRole("textbox", { name: "Connection name" });
  await expect(name).toHaveValue("Release assistant");
  await name.fill(" ");
  await expect(page.getByRole("button", { name: "Save name" })).toBeDisabled();
  await name.fill("  Updated assistant  ");
  await name.press("Enter");
  await expect(main.getByRole("heading", { level: 1, name: "Updated assistant" })).toBeVisible();
  await page.getByRole("navigation", { name: "Dashboard navigation" }).getByRole("link", { name: "Clients" }).click();
  await expect(table.getByRole("link", { name: "Updated assistant" })).toBeVisible();
  await expect(table.getByRole("link", { name: "Other connection" })).toBeVisible();
  await expect(table.getByRole("cell", { name: "Registered app", exact: true })).toHaveCount(2);
  expect(writes).toEqual([{ name: "Updated assistant" }]);
});
