import { test, expect } from "./fixtures.mjs";

test("dashboard pages share a title and domain description", async ({ page, origin }) => {
  await page.route("**/api/v1/session", route => route.fulfill({ json: {
    authenticated: true, user: { id: "owner" }, team: { id: "team", name: "Team" }, capabilities: [],
  } }));
  for (const endpoint of ["access/authorized-clients", "app-connections", "events"]) {
    await page.route("**/api/v1/" + endpoint, route => route.fulfill({ json: [] }));
  }
  await page.goto(origin + "/clients");

  const dashboard = page.getByRole("navigation", { name: "Dashboard navigation" });
  const main = page.getByRole("main");
  for (const [title, description] of [
    ["Clients", "All of the connected MCP clients"],
    ["Workloads", "Virtual Machines, VPSs, and other workloads that have been granted permissions"],
    ["Apps", "Apps connected to this Team"],
    ["Events", "MCP Events to help coordinate your agents"],
  ]) {
    await dashboard.getByRole("link", { name: title, exact: true }).click();
    await expect(main.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
    await expect(main.getByText(description, { exact: true })).toBeVisible();
  }
});
