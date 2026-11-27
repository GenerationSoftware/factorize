import { expect } from "@playwright/test";
import { test } from "./fixtures.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const target = { kind: "exe", id };
const linearTarget = { kind: "linear", id: "linear" };
const emptyImpact = {
  fingerprint: "initial", sources: [], lookups: [], pausedEvents: [], clients: [], workloads: [], needsConfirmation: false,
};
const dependentImpact = {
  fingerprint: "with-dependencies",
  sources: [{ id: "src-1", triggerId: "trigger-1", triggerName: "Daily inbox", eventId: "event-1", eventName: "New message", sourceName: "Inbox webhook", deleteTrigger: true }],
  lookups: [
    { eventId: "event-2", eventName: "Enriched message", name: "workspace", cascaded: false },
    { eventId: "event-2", eventName: "Enriched message", name: "details", cascaded: true },
  ],
  pausedEvents: [{ id: "event-2", name: "Enriched message" }],
  clients: [{ id: "client-1", name: "Inbox client" }],
  workloads: [{ id: "workload-1", name: "Inbox workload", revoked: true }],
  needsConfirmation: true,
};

async function mockRemoval(page, { impact, stale, installedTarget = target }) {
  let installed = true;
  let current = impact;
  const previews = [], confirms = [];
  await page.route("**/api/v1/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/session") return route.fulfill({ json: {
      authenticated: true, user: { id: "owner", email: "owner@example.test" },
      team: { id: "workspace", name: "Workspace", role: "owner" }, capabilities: [],
    } });
    if (path === "/api/v1/integrations") return route.fulfill({ json: {
      linear: installed && installedTarget.kind === "linear" ? { organizationName: "Test workspace", viewerEmail: null } : null,
      clickup: null, exeConnections: installed && installedTarget.kind === "exe" ? [{ connectionId: id }] : [],
      ampConnections: [], cloudflareTail: { installations: [] },
    } });
    if (path === "/api/v1/fly/connection") return route.fulfill({ json: { connection: null } });
    if (path === "/api/v1/integrations/bearer") return route.fulfill({ json: { integrations: [], revision: 0 } });
    if (path === "/api/v1/x/connections") return route.fulfill({ json: { connections: [] } });
    if (path === "/api/v1/integrations/cloudflare") return route.fulfill({ json: { connections: [] } });
    if (path === "/api/v1/integrations/removal/preview") {
      expect(route.request().method()).toBe("POST");
      previews.push(route.request().postDataJSON());
      return route.fulfill({ json: current });
    }
    if (path === "/api/v1/integrations/removal/confirm") {
      expect(route.request().method()).toBe("POST");
      confirms.push(route.request().postDataJSON());
      if (stale && confirms.length === 1) {
        current = stale;
        return route.fulfill({ status: 409, json: { error: { code: "conflict", message: "Removal impact changed" } } });
      }
      installed = false;
      return route.fulfill({ json: { deleted: true } });
    }
    return route.fulfill({ json: [] });
  });
  return { previews, confirms };
}

async function openRemoval(page, integration = "exe.dev") {
  await page.getByRole("button", { name: `Actions for ${integration}` }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  return page.getByRole("dialog", { name: `Delete ${integration}` });
}

test("dependency preview names affected objects; cancel does not write and stale confirmation requires a new review", async ({ page, origin }) => {
  const revised = { ...dependentImpact, fingerprint: "revised", clients: [{ id: "client-2", name: "Replacement client" }] };
  const { previews, confirms } = await mockRemoval(page, { impact: dependentImpact, stale: revised });
  await page.goto(origin + "/integrations");
  const dialog = await openRemoval(page);
  await expect(dialog.getByText(/Inbox webhook in Daily inbox/)).toBeVisible();
  await expect(dialog.getByText(/details in Enriched message.*Depends on a removed lookup/)).toBeVisible();
  await expect(dialog.getByText("Inbox client", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/Inbox workload.*Factorize grant revoked/)).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Events paused or left without active sources" })).toBeVisible();
  expect(previews).toEqual([target]);
  expect(confirms).toEqual([]);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: /Actions for exe\.dev/ })).toBeVisible();
  expect(confirms).toEqual([]);

  await openRemoval(page);
  const confirm = dialog.getByRole("button", { name: "Delete and apply changes" });
  await confirm.click();
  await expect(dialog.getByRole("alert")).toContainText("Review the updated impact and confirm again");
  await expect(dialog.getByText("Replacement client", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Inbox client", { exact: true })).toHaveCount(0);
  expect(previews).toEqual([target, target, target]);
  expect(confirms).toEqual([{ ...target, fingerprint: "with-dependencies", confirmImpact: true }]);
  await confirm.click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText(/exe\.dev.*deleted\.$/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Actions for exe\.dev/ })).toHaveCount(0);
  expect(confirms).toEqual([
    { ...target, fingerprint: "with-dependencies", confirmImpact: true },
    { ...target, fingerprint: "revised", confirmImpact: true },
  ]);
});

test("no-dependency removal gives simple confirmation and sends the exact fingerprint", async ({ page, origin }) => {
  const { previews, confirms } = await mockRemoval(page, { impact: emptyImpact });
  await page.goto(origin + "/integrations");
  const dialog = await openRemoval(page);
  await expect(dialog.getByText("It does not delete anything at the provider.", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Trigger sources removed" })).toHaveCount(0);
  expect(confirms).toEqual([]);
  await dialog.getByRole("button", { name: "Delete integration", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText(/exe\.dev.*deleted\.$/)).toBeVisible();
  expect(previews).toEqual([target]);
  expect(confirms).toEqual([{ ...target, fingerprint: "initial", confirmImpact: false }]);
});

test("Linear can be deleted from its row after reviewing the impact", async ({ page, origin }) => {
  const { previews, confirms } = await mockRemoval(page, { impact: dependentImpact, installedTarget: linearTarget });
  await page.goto(origin + "/integrations");
  const dialog = await openRemoval(page, "Linear");
  await expect(dialog.getByText(/Inbox webhook in Daily inbox/)).toBeVisible();
  expect(previews).toEqual([linearTarget]);
  expect(confirms).toEqual([]);
  await dialog.getByRole("button", { name: "Delete and apply changes", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("Linear deleted.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Actions for Linear · Test workspace", exact: true })).toHaveCount(0);
  expect(confirms).toEqual([{ ...linearTarget, fingerprint: "with-dependencies", confirmImpact: true }]);
});
