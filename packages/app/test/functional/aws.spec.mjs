import assert from "node:assert/strict";
import { test } from "./fixtures.mjs";

let origin, browser;
test.beforeAll(({ origin: appOrigin, browser: chromium }) => { origin = appOrigin; browser = chromium; });

test("AWS owner can prepare, download, verify, assign one client, and delete a connection", async () => {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  const id = "b8de6f86-65e6-4f75-ab35-7bf7d1a7dda7", client = "7129cc89-3dc2-4fc5-8f1f-7a5339183d39";
  const arn = "arn:aws:iam::123456789012:role/FactorizeInventory";
  const base = "/api/v1/integrations/aws";
  let saved = null;
  const template = JSON.stringify({ AWSTemplateFormatVersion: "2010-09-09" });
  await page.route("**/api/v1/**", route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/api/v1/session") return route.fulfill({ json: { authenticated: true, user: { id: "owner", email: "owner@example.test" }, team: { id: "workspace", name: "Workspace", role: "owner" }, capabilities: ["integrations:read", "integrations:write"] } });
    if (path === "/api/v1/fly/connection") return route.fulfill({ json: { connection: null } });
    if (path === "/api/v1/projects" || path === "/api/v1/team-permissions" || path.endsWith("providers/github/installations")) return route.fulfill({ json: [] });
    if (path === "/api/v1/integrations") return route.fulfill({ json: { exeConnections: [], ampConnections: [], cloudflareTail: { installations: [] }, linear: null, clickup: null } });
    if (path === "/api/v1/integrations/bearer") return route.fulfill({ json: { integrations: [], revision: 0 } });
    if (path === "/api/v1/x/connections" || path === "/api/v1/integrations/cloudflare") return route.fulfill({ json: { connections: [] } });
    if (path === "/api/v1/access/authorized-clients") return route.fulfill({ json: [{ grantId: client, clientName: "Test agent", credentialScopes: ["integrations:write"] }] });
    if (path === base && request.method() === "GET") return route.fulfill({ json: { available: true, connections: saved ? [saved] : [] } });
    if (path === base && request.method() === "POST") {
      assert.deepEqual(request.postDataJSON(), { name: "Sandbox inventory", region: "us-west-2" });
      saved = { id, name: "Sandbox inventory", region: "us-west-2", roleArn: null, oauthInstallationId: null, revision: 0 };
      return route.fulfill({ status: 201, json: { connection: saved, template } });
    }
    if (path === `${base}/${id}/verify`) {
      assert.deepEqual(request.postDataJSON(), { roleArn: arn });
      saved = { ...saved, roleArn: arn, revision: 1 };
      return route.fulfill({ json: { connection: saved, verified: true } });
    }
    if (path === `${base}/${id}/access`) {
      assert.deepEqual(request.postDataJSON(), { oauthInstallationId: client });
      saved = { ...saved, oauthInstallationId: client, revision: 2 };
      return route.fulfill({ json: saved });
    }
    if (path === `${base}/${id}` && request.method() === "DELETE") {
      saved = null;
      return route.fulfill({ json: { deleted: true } });
    }
    return route.fulfill({ json: {} });
  });
  try {
    await page.goto(origin + "/settings/integrations");
    await page.getByRole("button", { name: "Add AWS integration", exact: true }).click();
    await page.getByLabel("Connection name", { exact: true }).fill("Sandbox inventory");
    await page.getByRole("combobox", { name: "AWS Region", exact: true }).selectOption("us-west-2");
    await page.getByRole("button", { name: "Prepare AWS setup" }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download CloudFormation template" }).click();
    assert.equal((await download).suggestedFilename(), "factorize-aws-role.json");
    await page.getByLabel("AWS role ARN", { exact: true }).fill(arn);
    await page.getByRole("button", { name: "Verify AWS role" }).click();
    await page.getByText("AWS MCP Code Mode verified.", { exact: true }).waitFor();
    await page.getByRole("combobox", { name: "Code Mode access", exact: true }).selectOption(client);
    await page.getByRole("button", { name: "Save Code Mode access" }).click();
    await page.getByText("Code Mode access saved for the selected OAuth connection.", { exact: true }).waitFor();
    await page.getByRole("button", { name: /Close AWS connection/i }).click();
    await page.getByLabel("Actions for AWS · Sandbox inventory · us-west-2", { exact: true }).click();
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Delete AWS connection", exact: true }).click();
    await page.getByText("AWS connection deleted in Factorize.", { exact: true }).waitFor();
    assert.equal(saved, null);
  } finally { await context.close(); }
});
