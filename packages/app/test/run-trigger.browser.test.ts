// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { jobRunPage } from "../src/ui";

declare const document: any;

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function render(invocation?: Record<string, unknown>, name?: string) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const body = url.includes("/trace?")
      ? { items: [], nextCursor: null }
      : url.startsWith("/api/v1/jobs/")
        ? { name: "Job", triggers: [{ id: "trigger-1", slug: "renamed-trigger" }] }
        : { id: "run-1", job_id: "job-1", state: "succeeded", name, created_at: "2026-09-18T12:00:00Z", invocation };
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  }));
  const html = jobRunPage({ email: "owner@example.com" }, "run-1");
  document.body.innerHTML = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] ?? "";
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)![1];
  new Function(script)();
  await vi.waitFor(() => expect(document.querySelector("[data-run-trigger]")).not.toBeNull());
  return document.querySelector("[data-run-trigger]");
}

it.each([
  ["manual", "Manual", { prompt: "Review this issue" }],
  ["schedule", "Schedule", { cron: "0 9 * * *", timezone: "UTC" }],
  ["webhook", "Webhook", { provider: "linear", event: "Issue", issue: { identifier: "GEN-2112" } }],
  ["jobLifecycle", "Job lifecycle", { source_run_id: "previous-run", final_state: "succeeded" }],
])("shows recorded %s provenance independently of current trigger configuration", async (source, label, data) => {
  const context = { "original-trigger": data };
  const occurrence = { occurredAt: "2026-09-18T11:59:00Z", externalId: "event-1" };
  const section = await render({ source, trigger_id: "trigger-1", context, occurrence, created_at: "2026-09-18T12:00:00Z" });
  expect(section.textContent).toContain(label);
  expect(section.textContent).toContain("original-trigger");
  expect(section.textContent).not.toContain("renamed-trigger");
  expect(section.textContent).toContain("trigger-1");
  expect(section.textContent).toContain("2026-09-18T12:00:00Z");
  expect(section.querySelector("details").open).toBe(false);
  expect(JSON.parse(section.querySelector("pre").textContent)).toEqual({ context, occurrence });
});

it("escapes untrusted trigger names, source, and event payloads", async () => {
  const value = '<img src=x onerror="alert(1)">';
  const section = await render({ source: value, trigger_id: value, context: { [value]: { prompt: value } } });
  expect(section.querySelector("img")).toBeNull();
  expect(section.textContent).toContain(value);
});

it("handles missing provenance without breaking the run page", async () => {
  const section = await render();
  expect(section.textContent).toContain("Trigger information is not available for this run.");
  expect(document.querySelector("[data-run-prompt-details]")).not.toBeNull();
});

it("shows the run name and browser title alongside trigger provenance", async () => {
  const name = "Review GEN-2112";
  const section = await render({ source: "manual", trigger_id: "trigger-1" }, name);
  expect(document.querySelector("h1").textContent).toBe(name);
  expect(document.querySelector('[aria-current="page"]').textContent).toBe(name);
  expect(document.title).toBe(name + " — Factorize");
  expect(section.textContent).toContain("Manual");
  expect(section.textContent).toContain("trigger-1");
});
