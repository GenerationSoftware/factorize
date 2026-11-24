import { test, expect } from "./fixtures.mjs";

test("navigates Events, subscriptions and exact client connections through accessible dashboard tables", async ({ page, origin }) => {
  const definitionId = "30000000-0000-4000-8000-000000000001";
  const occurrenceId = "40000000-0000-4000-8000-000000000001";
  const definition = { id: definitionId, name: "orders.created", description: "New orders", revision: 1, payloadSchema: { type: "object" }, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", triggerCount: 1, occurrenceCount: 1 };
  await page.route("**/api/v1/session", route => route.fulfill({ json: { authenticated: true, user: { id: "owner" }, team: { id: "tenant", name: "Team" }, capabilities: [] } }));
  const otherEventId = "30000000-0000-4000-8000-000000000002";
  const timestamp = "2027-01-01T00:00:00.000Z";
  const requiredId = "sub_" + "a".repeat(64);
  const expiredId = "sub_" + "b".repeat(64);
  const otherId = "sub_" + "c".repeat(64);
  const base = { eventId: definitionId, eventName: definition.name, expiresAt: timestamp, status: "active" };
  const required = { ...base, id: requiredId, grantId: "primary", acknowledgmentMode: "required" };
  const expired = { ...base, id: expiredId, grantId: "secondary", status: "expired", acknowledgmentMode: "off" };
  const other = { ...base, id: otherId, eventId: otherEventId, eventName: "orders.shipped", grantId: "secondary", acknowledgmentMode: "off" };
  let deleted = false;
  await page.route("**/api/v1/access/authorized-clients", route => route.fulfill({ json: [
    { grantId: "primary", clientName: "Order assistant", clientId: "same-app", appName: "Registered app", expiresAt: null, authorizationDate: timestamp },
    { grantId: "secondary", clientName: "Other connection", clientId: "same-app", appName: "Registered app", expiresAt: null, authorizationDate: timestamp },
  ] }));
  await page.route("**/api/v1/event-subscriptions", route => route.fulfill({ json: deleted ? [other] : [required, expired, other] }));
  await page.route(`**/api/v1/event-subscriptions/${requiredId}`, route => route.fulfill({ json: required }));
  await page.route(`**/api/v1/events/${definitionId}`, route => {
    expect(route.request().method()).toBe("DELETE");
    deleted = true;
    return route.fulfill({ json: { id: definitionId, deleted: true } });
  });
  await page.route("**/api/v1/events", route => {
    expect(route.request().method()).toBe("GET");
    const remaining = { ...definition, id: otherEventId, name: "orders.shipped", description: "" };
    return route.fulfill({ json: deleted ? [remaining] : [definition, remaining] });
  });
  await page.route(`**/api/v1/events/${definitionId}/occurrences*`, route => route.fulfill({ json: { items: [{ id: occurrenceId, revision: 1, occurredAt: "2026-01-02T03:04:05.000Z", payload: { orderId: "order-42" }, producer: { kind: "trigger" }, createdAt: "2026-01-02T03:04:05.000Z" }], nextCursor: null } }));

  await page.goto(origin + "/events");
  const nav = page.getByRole("navigation", { name: "Event navigation" });
  const events = page.getByRole("table", { name: "Events", exact: true });
  await expect(page.getByRole("heading", { name: "Events", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Events", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(events.getByRole("columnheader")).toHaveText(["Name", "Description", "Subscribers"]);
  await expect(events.getByRole("row", { name: /orders.created/ }).getByRole("cell").last()).toHaveText("1");
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create Event" })).toHaveCount(0);
  await expect(page.getByRole("main").locator("form")).toHaveCount(0);

  const created = events.getByRole("link", { name: "orders.created" });
  await created.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(origin + "/events/" + definitionId);
  await expect(page.getByRole("heading", { name: "orders.created", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Dashboard navigation" }).getByRole("link", { name: "Events" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Payload schema" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Edit\b/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeVisible();
  await expect(page.getByText('"orderId": "order-42"')).toBeVisible();
  const subscriptions = page.getByRole("table", { name: "Event subscriptions" });
  await expect(subscriptions.getByRole("columnheader")).toHaveText(["Client", "Event", "Status", "Acknowledgment mode", "Expires"]);
  await expect(subscriptions.getByRole("row")).toHaveCount(3);
  await expect(subscriptions.getByRole("cell", { name: "Required" })).toBeVisible();
  await expect(subscriptions.getByRole("cell", { name: "Expired" })).toBeVisible();
  await subscriptions.getByRole("link", { name: /aaaaaaaa/ }).click();
  await expect(page).toHaveURL(origin + "/events/subscriptions/" + requiredId);
  await expect(page.getByText(requiredId, { exact: true })).toBeVisible();

  await nav.getByRole("link", { name: "Subscriptions" }).click();
  await expect(subscriptions.getByRole("row")).toHaveCount(4);
  await subscriptions.getByRole("link", { name: "Order assistant" }).click();
  await expect(page).toHaveURL(origin + "/clients/primary");
  await expect(subscriptions.getByRole("columnheader")).toHaveText(["Event", "Status", "Acknowledgment mode", "Expires"]);
  await expect(subscriptions.getByRole("row")).toHaveCount(2);
  await expect(subscriptions.getByRole("cell", { name: "Required" })).toBeVisible();
  await expect(subscriptions.getByRole("cell", { name: "Expired" })).toHaveCount(0);

  await page.goto(origin + "/events");
  const description = await events.getByRole("cell", { name: "New orders" }).boundingBox();
  expect(description).not.toBeNull();
  await page.mouse.click(description.x + description.width / 2, description.y + description.height / 2);
  await expect(page).toHaveURL(origin + "/events/" + definitionId);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL(origin + "/events");
  await expect(events.getByRole("link", { name: "orders.created" })).toHaveCount(0);
  await nav.getByRole("link", { name: "Subscriptions" }).click();
  await expect(subscriptions.getByRole("row")).toHaveCount(2);
  await expect(subscriptions.getByRole("link", { name: /orders.shipped/ })).toBeVisible();
});
