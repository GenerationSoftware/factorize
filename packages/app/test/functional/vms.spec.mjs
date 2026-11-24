import { test, expect } from "./fixtures.mjs";

const id = "30000000-0000-4000-8000-000000000011";
const providerId = "30000000-0000-4000-8000-000000000012";
const presetId = "30000000-0000-4000-8000-000000000013";
const timestamp = "2026-01-01T00:00:00.000Z";
const grant = {
  id, providerId, provider: "fly.io", vm: "machine-1", app: "orders", scopes: ["triggers:read"],
  presetId, presetName: "Events", revision: 1, createdAt: timestamp, updatedAt: timestamp,
};

async function session(page, capabilities) {
  await page.route("**/api/v1/session", route => route.fulfill({ json: {
    authenticated: true, user: { id: "owner" }, team: { id: "team", name: "Team" }, capabilities,
  } }));
}

test("a team member with read access can open workload details from the table", async ({ page, origin }) => {
  await session(page, ["vms:read"]);
  await page.route("**/api/v1/vms", route => route.fulfill({ json: [grant] }));
  await page.goto(origin + "/vms");
  const navigation = page.getByRole("navigation", { name: "Dashboard navigation" });
  await expect(navigation.getByRole("link", { name: "Workloads" })).toHaveAttribute("aria-current", "page");
  const links = await navigation.getByRole("link").allTextContents();
  expect(links).toEqual(["Clients", "Workloads", "Apps", "Events", "Settings"]);
  await expect(page).toHaveURL(origin + "/workloads");
  const table = page.getByRole("table", { name: "Workloads" });
  await expect(table.getByRole("columnheader", { name: "Provider" })).toBeVisible();
  await expect(table.getByRole("cell", { name: "Fly.io" })).toBeVisible();
  await table.getByRole("link", { name: "orders/machine-1" }).click();
  await expect(page).toHaveURL(origin + "/workloads/" + id);
  await expect(page.getByRole("heading", { name: "orders/machine-1" })).toBeVisible();
  await expect(page.getByText("triggers:read")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit permissions" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Revoke permissions" })).toHaveCount(0);
});

test("edit refreshes a stale grant, saves explicit scopes, and revokes permissions", async ({ page, origin }) => {
  await session(page, ["team:read", "vms:read", "vms:edit"]);
  let active = { ...grant };
  await page.route("**/api/v1/vms", route => route.fulfill({ json: active ? [active] : [] }));
  await page.route("**/api/v1/permission-presets", route => route.fulfill({ json: [{
    id: presetId, name: "Events", scopes: ["triggers:read"], revision: 1, isDefault: false, createdAt: timestamp, updatedAt: timestamp,
  }] }));
  await page.route("**/api/v1/vms/grants", route => {
    expect(route.request().method()).toBe("POST");
    const change = route.request().postDataJSON();
    if (change.target.expectedRevision === 1) {
      expect(change).toEqual({ target: { kind: "existing", grantId: id, expectedRevision: 1 }, permissions: { presetId } });
      active = { ...active, revision: 2, scopes: ["integrations:read"] };
      return route.fulfill({ status: 409, json: { error: { message: "The VM grant changed. Refresh it and retry." } } });
    }
    expect(change).toEqual({ target: { kind: "existing", grantId: id, expectedRevision: 2 }, permissions: { scopes: ["integrations:read", "vms:read"] } });
    active = { ...active, revision: 3, scopes: change.permissions.scopes, presetId: null, presetName: null };
    return route.fulfill({ json: active });
  });
  await page.route(`**/api/v1/vms/grants/${id}`, route => {
    expect(route.request().method()).toBe("DELETE");
    active = null;
    return route.fulfill({ json: { id, revoked: true } });
  });
  await page.goto(origin + "/workloads/" + id);
  await page.getByRole("button", { name: "Edit permissions" }).click();
  await page.getByLabel("Permission source").selectOption({ label: "Events" });
  await page.getByRole("button", { name: "Save permissions" }).click();
  await expect(page.getByRole("alert")).toHaveText("The VM grant changed. Refresh it and retry.");
  await expect(page.getByText("integrations:read", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit permissions" }).click();
  await page.getByLabel("Permission scopes").fill("integrations:read\nvms:read");
  await page.getByRole("button", { name: "Save permissions" }).click();
  await expect(page.getByText("integrations:read, vms:read")).toBeVisible();
  page.once("dialog", dialog => {
    expect(dialog.message()).toContain("The VM will keep running.");
    return dialog.accept();
  });
  await page.getByRole("button", { name: "Revoke permissions" }).click();
  await expect(page.getByText("No workloads have Factorize permissions.")).toBeVisible();
});

test("shows a VM list error and offers no initial enrollment button", async ({ page, origin }) => {
  await session(page, ["vms:read", "vms:edit"]);
  await page.route("**/api/v1/vms", route => route.fulfill({
    status: 503, json: { error: { message: "The VM list is temporarily unavailable." } },
  }));
  await page.goto(origin + "/vms");
  await expect(page.getByRole("alert")).toHaveText("The VM list is temporarily unavailable.", { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Grant permissions" })).toHaveCount(0);
});
