import { test, expect } from "./fixtures.mjs";

test("an owner saves a read-only Hetzner project, views inventory, replaces the token without a separate permission switch, and confirms local deletion", async ({ page, origin }) => {
  const token = "syntheticReadOnlyProjectToken", writeToken = "syntheticReadWriteProjectToken";
  const requests = [];
  let connection = null, unavailable = true, verifiedPin = null;
  const hostFingerprint = "SHA256:" + "A".repeat(43);
  const requestId = "f0bda107-b72f-4a94-8148-c4282983b994";
  await page.route("**/api/v1/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/session") return route.fulfill({ json: {
      authenticated: true, user: { id: "owner", email: "owner@example.test" },
      team: { id: "workspace", name: "Workspace", role: "owner" }, capabilities: [],
    } });
    if (path === "/api/v1/integrations") return route.fulfill({ json: {
      linear: null, clickup: null, exeConnections: [], ampConnections: [], cloudflareTail: { installations: [] },
    } });
    if (path === "/api/v1/hetzner/connection") {
      const method = route.request().method();
      requests.push(method);
      if (method === "PUT") {
        const provisioning = Boolean(connection);
        expect(route.request().postDataJSON()).toEqual({ name: "Fixture project", ...(provisioning ? { token: writeToken } : { token }) });
        if (unavailable) return route.fulfill({ status: 502, headers: { "X-Request-Id": requestId },
          json: { error: { code: "hetzner_inventory_error", message: "Hetzner server inventory is unavailable. Try again." } } });
        connection = { name: "Fixture project" };
      }
      if (method === "DELETE") {
        connection = null;
        return route.fulfill({ json: { deleted: true } });
      }
      return route.fulfill({ json: { connection } });
    }
    if (path === "/api/v1/hetzner/servers") {
      requests.push("inventory");
      expect(route.request().method()).toBe("GET");
      return route.fulfill({ json: { servers: [{ id: 41, name: "ci-worker", status: "running", location: "hel1" }], truncated: true } });
    }
    if (path === "/api/v1/ssh/hetzner-targets") return route.fulfill({ json: { targets: verifiedPin ? [verifiedPin] : [] } });
    if (path === "/api/v1/ssh/hetzner-targets/41") {
      expect(route.request().method()).toBe("PUT");
      expect(route.request().postDataJSON()).toEqual({ username: "runner", hostFingerprint });
      verifiedPin = { serverId: 41, username: "runner", hostFingerprint, needsVerification: false };
      return route.fulfill({ json: verifiedPin });
    }
    if (path === "/api/v1/fly/connection") return route.fulfill({ json: { connection: null } });
    if (path === "/api/v1/integrations/bearer") return route.fulfill({ json: { integrations: [], revision: 0 } });
    if (path === "/api/v1/x/connections" || path === "/api/v1/integrations/cloudflare") return route.fulfill({ json: { connections: [] } });
    return route.fulfill({ json: [] });
  });
  await page.goto(origin + "/integrations");
  await page.getByRole("button", { name: "Add Hetzner Cloud integration" }).click();
  const add = page.getByRole("dialog", { name: "Add Hetzner Cloud integration" });
  await add.getByLabel("Project name").fill("Fixture project");
  const tokenInput = add.getByLabel("Project API token");
  await expect(tokenInput).toHaveAttribute("type", "password");
  await tokenInput.fill(token);
  await add.getByRole("button", { name: "Save connection" }).click();
  await expect(add.getByRole("alert")).toHaveText(`Hetzner server inventory is unavailable. Try again. (Request ID: ${requestId})`);
  unavailable = false;
  await tokenInput.fill(token);
  await add.getByRole("button", { name: "Save connection" }).click();
  await expect(add).not.toBeVisible();
  const row = page.getByRole("row", { name: /Fixture project/ });
  await expect(row.getByText("Owner only")).toHaveCount(0);
  expect(requests).not.toContain("inventory");
  await row.getByRole("button", { name: "Actions for Hetzner Cloud · Fixture project" }).click();
  await page.getByRole("menuitem", { name: "View servers" }).click();
  const inventory = page.getByRole("dialog", { name: "Hetzner Cloud servers" });
  await expect(inventory.getByRole("table").getByRole("row", { name: "ci-worker running hel1" })).toBeVisible();
  await expect(inventory.getByText("Showing the first 100 servers.")).toBeVisible();
  expect(requests).toContain("inventory");
  const ssh = inventory.getByRole("region", { name: "Hetzner SSH commands" });
  await ssh.getByLabel("Server for SSH commands").selectOption("41");
  await ssh.getByLabel("SSH username", { exact: true }).fill("runner");
  await ssh.getByLabel("Verified SSH host fingerprint").fill(hostFingerprint);
  await ssh.getByRole("button", { name: "Save verified fingerprint" }).click();
  await expect(ssh.getByText("SSH fingerprint verified and saved.")).toBeVisible();
  await expect(ssh.getByText("Verified", { exact: true })).toBeVisible();
  await inventory.getByRole("button", { name: "Close Hetzner Cloud servers" }).click();
  await row.getByRole("button", { name: "Actions for Hetzner Cloud · Fixture project" }).click();
  await page.getByRole("menuitem", { name: "Replace connection", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Replace Hetzner Cloud connection" });
  await expect(edit.getByRole("checkbox")).toHaveCount(0);
  await expect(edit.getByText(/create billable resources/)).toBeVisible();
  await edit.getByLabel("Project API token").fill(writeToken);
  await edit.getByRole("button", { name: "Save connection" }).click();
  await expect(edit).not.toBeVisible();
  await row.getByRole("button", { name: "Actions for Hetzner Cloud · Fixture project" }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const deletion = page.getByRole("dialog", { name: "Delete Hetzner Cloud connection?" });
  await expect(deletion).toBeVisible();
  expect(requests).not.toContain("DELETE");
  await deletion.getByRole("button", { name: "Delete connection" }).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByText("Hetzner Cloud connection deleted.")).toBeVisible();
  expect(requests.filter(method => method === "DELETE")).toHaveLength(1);
});
