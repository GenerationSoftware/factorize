import { test, expect } from "./fixtures.mjs";

const pages = [
  { path: "/clients", chunk: "authorized-clients", endpoint: "/api/v1/access/authorized-clients", title: "Clients", empty: "No authorized clients." },
  { path: "/events", chunk: "events", endpoint: "/api/v1/events", title: "Events", empty: "No Events yet." },
  { path: "/workloads", chunk: "workloads", endpoint: "/api/v1/vms", title: "Workloads", empty: "No workloads have Factorize permissions." },
];
const owner = { authenticated: true, user: { id: "owner" }, team: { id: "team", name: "Team" }, capabilities: ["vms:read"] };

for (const route of pages) {
  test(`the ${route.title} route starts its query after the session guard without waiting for lazy JS`, async ({ page, origin }) => {
    const sessionGate = Promise.withResolvers(), chunkGate = Promise.withResolvers();
    let reads = 0;
    const chunk = new RegExp(`/assets/${route.chunk}-[^/]+\\.js$`);
    await page.route("**/api/v1/session", async request => {
      await sessionGate.promise;
      await request.fulfill({ json: owner });
    });
    await page.route(chunk, async request => {
      await chunkGate.promise;
      await request.continue();
    });
    await page.route("**" + route.endpoint, async request => {
      reads++;
      await request.fulfill({ json: [] });
    });
    await page.route("**/api/v1/app-connections", request => request.fulfill({ json: [] }));

    try {
      const pendingSession = page.waitForRequest(origin + "/api/v1/session");
      const navigation = page.goto(origin + route.path, { waitUntil: "domcontentloaded" });
      await pendingSession;
      expect(reads).toBe(0);
      const chunkRequested = page.waitForRequest(chunk, { timeout: 5_000 });
      const primaryResponse = page.waitForResponse(origin + route.endpoint, { timeout: 5_000 });
      sessionGate.resolve();
      // Require the API to finish while this page's lazy JS is still held.
      const [response] = await Promise.all([primaryResponse, chunkRequested]);
      expect(response.status()).toBe(200);
      expect(await response.finished()).toBeNull();
      chunkGate.resolve();
      await navigation;

      const nav = page.getByRole("navigation", { name: "Dashboard navigation" });
      const main = page.getByRole("main");
      await expect(main.getByRole("heading", { name: route.title, exact: true })).toBeVisible();
      await expect(main.getByText(route.empty, { exact: true })).toBeVisible();
      expect(reads).toBe(1);
      await nav.getByRole("link", { name: "Apps", exact: true }).click();
      await expect(main.getByRole("heading", { name: "Apps", exact: true })).toBeVisible();
      await nav.getByRole("link", { name: route.title, exact: true }).click();
      await expect(main.getByText(route.empty, { exact: true })).toBeVisible();
      expect(reads).toBe(1);
    } finally {
      sessionGate.resolve();
      chunkGate.resolve();
    }
  });

  test(`anonymous navigation to ${route.title} does not start its query`, async ({ page, origin }) => {
    let reads = 0;
    await page.route("**/api/v1/session", request => request.fulfill({ json: { authenticated: false } }));
    await page.route("**" + route.endpoint, request => {
      reads++;
      return request.fulfill({ status: 401, json: {} });
    });
    await page.goto(origin + route.path);
    await expect(page).toHaveURL(/\/auth\/login\?/);
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    expect(reads).toBe(0);
  });
}

test("Workloads without VM read permission does not start the loader or page query", async ({ page, origin }) => {
  let reads = 0;
  await page.route("**/api/v1/session", request => request.fulfill({ json: { ...owner, capabilities: [] } }));
  await page.route("**/api/v1/vms", request => {
    reads++;
    return request.fulfill({ json: [] });
  });
  await page.goto(origin + "/workloads");
  await expect(page.getByText("You need VM read access to view these workloads.")).toBeVisible();
  expect(reads).toBe(0);
});

test("the Clients page can render its loading and API-error UI while its route query is pending", async ({ page, origin }) => {
  const apiGate = Promise.withResolvers();
  await page.route("**/api/v1/session", request => request.fulfill({ json: owner }));
  await page.route("**/api/v1/access/authorized-clients", async request => {
    await apiGate.promise;
    await request.fulfill({ status: 502, json: { error: { code: "operation_failed", message: "Fixture clients unavailable" } } });
  });
  try {
    await page.goto(origin + "/clients");
    await expect(page.getByRole("status").filter({ hasText: "Loading clients…" })).toBeVisible();
  } finally {
    apiGate.resolve();
  }
  await expect(page.getByRole("alert")).toHaveText("Fixture clients unavailable");
});
