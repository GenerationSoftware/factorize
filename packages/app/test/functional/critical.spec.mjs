import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

let server;
let origin;

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://fixture").pathname;
    const file = /^(\/assets\/|\/theme-init\.js$|\/bee-mark-monochrome\.png$|\/favicon\.ico$)/.test(path) ? path : "/index.html";
    try {
      const body = await readFile(new URL("../../dist" + file, import.meta.url));
      res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".png") ? "image/png" : "text/html");
      res.end(body);
    } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => { if (server) await new Promise(resolve => server.close(resolve)); });

test("create an Event and inspect its durable occurrence through the shared API", async ({ page }) => {
  const definitionId = "30000000-0000-4000-8000-000000000001";
  const occurrenceId = "40000000-0000-4000-8000-000000000001";
  const definition = { id: definitionId, name: "orders.created", description: "New orders", revision: 1, payloadSchema: { type: "object" }, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", triggerCount: 1, occurrenceCount: 1 };
  await page.route("**/api/v1/session", route => route.fulfill({ json: { authenticated: true, user: { id: "owner" }, team: { id: "tenant", name: "Team" }, capabilities: [] } }));
  await page.route("**/api/v1/events", async route => {
    if (route.request().method() === "POST") return route.fulfill({ status: 201, json: { ...definition, name: JSON.parse(route.request().postData()).name } });
    return route.fulfill({ json: [definition] });
  });
  await page.route(`**/api/v1/events/${definitionId}/occurrences*`, route => route.fulfill({ json: { items: [{ id: occurrenceId, revision: 1, occurredAt: "2026-01-02T03:04:05.000Z", payload: { orderId: "order-42" }, producer: { kind: "trigger" }, createdAt: "2026-01-02T03:04:05.000Z" }], nextCursor: null } }));

  await page.goto(origin + "/events");
  await expect(page.getByRole("heading", { name: "Events", exact: true })).toBeVisible();
  await page.getByLabel("Name").fill("orders.created");
  await page.getByLabel("Description").fill("New orders");
  await page.getByRole("button", { name: "Create Event" }).click();
  await expect(page.getByText('"orderId": "order-42"')).toBeVisible();
  await expect(page.getByText(/1 occurrences/)).toBeVisible();
});
