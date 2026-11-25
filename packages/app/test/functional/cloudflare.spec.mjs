import { expect } from "@playwright/test";
import { test } from "./fixtures.mjs";

test("connects directly on Cloudflare and returns connected without a Factorize picker or write toggle", async ({ page, origin }) => {
  let connected = false;
  const calls = [];
  await page.route("**/api/v1/session", route => route.fulfill({ json: {
    authenticated: true, user: { id: "owner", email: "owner@example.test" },
    team: { id: "workspace", name: "Workspace", role: "owner" }, capabilities: [],
  } }));
  await page.route("**/api/v1/integrations/cloudflare", route => route.fulfill({ json: {
    configured: true, connections: connected ? [{ id: "fff79888-6e7f-4efa-94ab-ecab849396de", name: "Cloudflare", connected: true, reconnectRequired: false }] : [],
  } }));
  await page.route("**/api/v1/integrations/cloudflare/authorize", route => {
    calls.push(route.request().postData());
    return route.fulfill({ json: { authorizationUrl: "https://dash.cloudflare.com/oauth2/auth?fixture=1" } });
  });
  await page.route("https://dash.cloudflare.com/oauth2/auth?fixture=1", route => {
    connected = true;
    return route.fulfill({ status: 302, headers: { location: origin + "/integrations?cloudflare=connected" } });
  });
  await page.goto(origin + "/integrations");
  await page.getByRole("button", { name: "Add Cloudflare integration", exact: true }).click();
  await expect(page.getByText("Permissions managed in Cloudflare")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /DNS writes/i })).toHaveCount(0);
  await expect(page.getByLabel("Authorized Cloudflare account")).toHaveCount(0);
  expect(calls).toEqual([null]);
});

test("shows a fixed Cloudflare failure explanation without reflecting callback input", async ({ page, origin }) => {
  await page.route("**/api/v1/session", route => route.fulfill({ json: {
    authenticated: true, user: { id: "owner", email: "owner@example.test" },
    team: { id: "workspace", name: "Workspace", role: "owner" }, capabilities: [],
  } }));
  await page.route("**/api/v1/integrations/cloudflare", route => route.fulfill({ json: { configured: true, connections: [] } }));
  await page.goto(origin + "/integrations?cloudflare=failed&cloudflare_error=token_client_rejected");
  await expect(page.getByText("Cloudflare rejected the OAuth client.", { exact: false })).toBeVisible();
  await page.goto(origin + "/integrations?cloudflare=failed&cloudflare_error=untrusted-provider-fixture");
  await expect(page.getByText("Cloudflare did not complete authorization.", { exact: false })).toBeVisible();
  await expect(page.getByText("untrusted-provider-fixture", { exact: false })).toHaveCount(0);
});
