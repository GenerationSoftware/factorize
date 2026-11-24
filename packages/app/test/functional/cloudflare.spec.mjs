import { expect } from "@playwright/test";
import { test } from "./fixtures.mjs";

test("connects a Cloudflare account through OAuth without an API key and defaults to read-only", async ({ page, origin }) => {
  const account = { id: "a".repeat(32), name: "Production account" };
  const calls = [];
  let authorized = false, connected = false;
  await page.route("**/api/v1/session", route => route.fulfill({ json: {
    authenticated: true, user: { id: "owner", email: "owner@example.test" },
    team: { id: "workspace", name: "Workspace", role: "owner" }, capabilities: [],
  } }));
  await page.route("**/api/v1/integrations/cloudflare", route => route.fulfill({ json: {
    configured: true, writeAvailable: true, accounts: authorized && !connected ? [account] : [],
    connections: connected ? [{ id: "fff79888-6e7f-4efa-94ab-ecab849396de", name: account.name, accountId: account.id, writeEnabled: false, connected: true }] : [],
  } }));
  await page.route("**/api/v1/integrations/cloudflare/authorize", route => {
    calls.push(route.request().postDataJSON());
    authorized = true;
    return route.fulfill({ json: { authorizationUrl: origin + "/integrations?cloudflare=select" } });
  });
  await page.route("**/api/v1/integrations/cloudflare/select", route => {
    expect(route.request().postDataJSON()).toEqual({ accountId: account.id });
    connected = true;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto(origin + "/integrations");
  await expect(page.getByRole("button", { name: "Add Cloudflare Tail integration" })).toHaveCount(0);
  await page.getByRole("button", { name: "Add Cloudflare integration", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Enable DNS writes (optional)" })).not.toBeChecked();
  await expect(page.getByText("No API key is needed.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Continue to Cloudflare" }).click();
  await page.getByLabel("Authorized Cloudflare account").selectOption(account.id);
  await page.getByRole("button", { name: "Connect selected account" }).click();
  await expect(page.getByText("Cloudflare · Production account", { exact: true })).toBeVisible();
  await expect(page.getByText("Read only", { exact: false })).toBeVisible();
  expect(calls).toEqual([{ enableWrites: false }]);
});
