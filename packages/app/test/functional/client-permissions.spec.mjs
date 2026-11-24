import { expect } from "@playwright/test";
import { test } from "./fixtures.mjs";

test("saving client permissions keeps a blocked integration unchecked until explicitly selected", async ({ page, origin }) => {
  const integrationId = "18a2410e-ea09-4fe0-af8a-719c0c91e6e2";
  const integrationScope = `integration:${integrationId}:1`;
  const initialScopes = ["team:read", "proxy:use"];
  const editedScopes = ["team:read", "team:write", "proxy:use"];
  let revision = 1;
  let scopes = initialScopes;
  let denied = true;
  const edits = [];
  await page.route("**/api/v1/session", route => route.fulfill({ json: {
    authenticated: true, user: { id: "owner", email: "owner@example.test" },
    team: { id: "workspace", name: "Workspace", role: "owner" }, capabilities: [],
  } }));
  await page.route("**/api/v1/access/authorized-clients", route => route.fulfill({ json: [{
    grantId: "fixture-grant", clientId: "fixture-client", clientName: "Fixture client",
    availableScopes: [...editedScopes, integrationScope], scopes, revision,
    scopeLabels: { [integrationScope]: "Linear integration access" },
    integrationOverrides: denied ? { [integrationId]: false } : {},
    authorizationDate: "2026-10-09T12:00:00Z", expiresAt: null, lastUsedAt: null,
  }] }));
  await page.route("**/api/v1/access/authorizations/fixture-grant/permissions", route => {
    const edit = route.request().postDataJSON();
    edits.push(edit);
    revision++;
    scopes = edit.scopes;
    if (edit.integrationOverrides?.[integrationId] === integrationScope) denied = false;
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
    integrationOverrides: { [integrationId]: integrationScope },
  });
});


test("renames a connection from the list and detail without changing the registered app or sibling connection", async ({ page, origin }) => {
  const grant = { grantId: "primary", clientId: "same-app", clientName: "Registered app", appName: "Registered app",
    availableScopes: ["team:read"], scopes: ["team:read"], revision: 0, scopeLabels: {}, integrationOverrides: {},
    authorizationDate: "2026-10-09T12:00:00Z", expiresAt: null, lastUsedAt: null };
  const writes = [];
  await page.route("**/api/v1/session", route => route.fulfill({ json: {
    authenticated: true, user: { id: "owner", email: "owner@example.test" },
    team: { id: "workspace", name: "Workspace", role: "owner" }, capabilities: [],
  } }));
  await page.route("**/api/v1/access/authorized-clients", route => route.fulfill({ json: [grant,
    { ...grant, grantId: "sibling", clientName: "Other connection" }] }));
  await page.route("**/api/v1/access/authorizations/primary/name", route => {
    expect(route.request().method()).toBe("PUT");
    const body = route.request().postDataJSON();
    writes.push(body);
    grant.clientName = body.name;
    return route.fulfill({ json: body });
  });

  await page.goto(origin + "/clients");
  const row = page.getByRole("row", { name: /Registered app/ }).filter({ has: page.getByRole("link", { name: "Registered app" }) });
  await row.getByRole("button", { name: "Rename connection" }).click();
  const name = page.getByRole("textbox", { name: "Connection name" });
  await expect(name).toHaveValue("Registered app");
  await name.fill(" ");
  await expect(page.getByRole("button", { name: "Save name" })).toBeDisabled();
  await name.fill("  Release assistant  ");
  await name.press("Enter");
  await expect(page.getByRole("link", { name: "Release assistant" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Other connection" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Registered app", exact: true })).toHaveCount(2);

  await page.getByRole("link", { name: "Release assistant" }).click();
  await expect(page.getByRole("heading", { name: "Release assistant", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Rename connection" }).click();
  await expect(name).toHaveValue("Release assistant");
  await name.fill("Updated assistant");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("heading", { name: "Updated assistant" })).toBeVisible();
  expect(writes).toEqual([{ name: "Release assistant" }, { name: "Updated assistant" }]);
});
