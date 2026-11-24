import { test, expect } from "./fixtures.mjs";

test("Connected apps use the dashboard tab and Registered apps live in Settings", async ({ page, origin }) => {
  await page.route("**/api/v1/session", route => route.fulfill({ json: {
    authenticated: true, user: { id: "owner" }, team: { id: "team", name: "Team" }, capabilities: [],
  } }));
  await page.route("**/api/v1/app-connections", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/apps", route => route.fulfill({ json: [] }));
  await page.goto(origin + "/apps");
  const dashboard = page.getByRole("navigation", { name: "Dashboard navigation" });
  await expect(dashboard.getByRole("link", { name: "Apps", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Connected apps" })).toBeVisible();
  await expect(page.getByText("No connected apps.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Registered apps" })).toHaveCount(0);

  await page.goto(origin + "/apps/registered?source=bookmark#list");
  await expect(page).toHaveURL(origin + "/settings/apps?source=bookmark#list");
  await expect(dashboard.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
  const settings = page.getByRole("navigation", { name: "Settings", exact: true });
  await expect(settings.getByRole("link", { name: "Registered apps" })).toHaveAttribute("href", "/settings/apps");
  await expect(page.getByRole("heading", { name: "Registered apps" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Register app" })).toBeVisible();
});
