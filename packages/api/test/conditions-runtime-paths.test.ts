import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { AutomationScheduler } from "../src/postgres/automation-scheduler";
import { WebhookService } from "../src/postgres/webhook-service";
import { InvocationError, InvocationService } from "../src/job-domain";
import { adaptWebhook } from "../src/webhook-trigger";
import { evaluateWebhookConditions } from "../src/webhook-conditions";
vi.mock("../src/github", () => ({ installationToken: vi.fn(async () => "fixture-token"), githubHeaders: () => ({}) }));
afterEach(() => vi.restoreAllMocks());
const build = JSON.parse(readFileSync(new URL("../migrations/build-manager-conditions.json", import.meta.url), "utf8"));
const leaf = (path: string, value: unknown) => ({ fact: "webhook", path, operator: "equal", value });
function fixture(conditions: unknown = build) {
  const config: any = { provider: "github", installationId: 1, repositoryId: 2, event: "pull_request", action: "dequeued", conditions };
  const payload = { installation: { id: 1 }, repository: { id: 2 }, action: "dequeued", pull_request: { number: 3, state: "open", base: { ref: "main" } } };
  const row: any = { id: "verification", tenant_id: "tenant", trigger_id: "trigger", event_id: "event-id", event_slug: "event-2", event_config: config, event_enabled: true, trigger_enabled: true, removed_at: null, installation_state: "active", payload, delivery_id: "delivery", attempt: 0 };
  const query = vi.fn(async (sql: string) => ({ rows: sql.includes("SELECT p.*") ? [row] : [] }));
  const database: any = { pool: { query }, transaction: async (fn: any) => fn({ query }) };
  const env: any = {};
  const scheduler = new AutomationScheduler(database, env), ordinary = new WebhookService(database, env, "tenant");
  vi.spyOn(ordinary as any, "candidates").mockImplementation(async () => [{ trigger: { id: "trigger" }, eventId: "event-id", eventSlug: "event-2", config }]);
  vi.spyOn(ordinary as any, "ensure").mockResolvedValue("delivery-pk");
  const event = vi.spyOn(ordinary as any, "event").mockResolvedValue(undefined);
  const invoke = vi.spyOn(InvocationService.prototype, "invoke").mockResolvedValue({ duplicate: false } as any);
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ state: "open", base: { ref: "main" }, mergeable: false, mergeable_state: "dirty" }));
  return { config, payload, row, query, scheduler, ordinary, event, invoke, fetch };
}
describe("condition execution contract", () => {
  it.each([
    ["success", "gh-readonly-queue/main/x", "human", "actions"],
    ["success", "main", "github-merge-queue[bot]", "actions"],
    ["skipped", "feature", "human", "mintlify"],
    ["failure", "feature", "human", "actions"],
    [undefined, undefined, undefined, undefined],
  ])("preview and both paths agree and keep prepared context for %s/%s", async (conclusion, branch, sender, app) => {
    const f = fixture();
    Object.assign(f.payload, { check_suite: { conclusion, head_branch: branch, app: { slug: app } }, sender: { login: sender } });
    const prepared = adaptWebhook(f.config, "github", "delivery", f.payload, "pull_request")!.payload;
    const verified = { ...prepared, pull_request: { ...f.payload.pull_request, mergeable: false, mergeable_state: "dirty" } };
    const preview = await evaluateWebhookConditions(build, prepared), delayedPreview = await evaluateWebhookConditions(build, verified);
    expect(preview.decision).toBe(delayedPreview.decision);
    await (f.ordinary as any).invoke("github", "delivery", f.payload, "pull_request");
    expect(f.invoke).toHaveBeenCalledTimes(preview.decision === "match" ? 1 : 0);
    if (preview.decision === "match") expect(f.invoke.mock.calls[0][1]).toMatchObject({ claimKey: "webhook:event-id:webhook:github:delivery", context: { "event-2": prepared } });
    f.invoke.mockClear();
    await (f.scheduler as any).githubVerifications();
    expect(f.invoke).toHaveBeenCalledTimes(preview.decision === "match" ? 1 : 0);
    if (preview.decision === "match") expect(f.invoke.mock.calls[0][1]).toMatchObject({ context: { "event-2": verified } });
    else expect(f.query.mock.calls.some(([sql, values]: any) => sql.includes("INSERT INTO app.trigger_events") && values.includes("excluded"))).toBe(true);
  });
  it("continues after invalid candidates and keeps duplicate/queue_full distinct", async () => {
    const f = fixture();
    vi.spyOn(f.ordinary as any, "candidates").mockResolvedValue([
      { trigger: { id: "invalid" }, eventId: "invalid", eventSlug: "hook", config: { ...f.config, conditions: { all: [] } } },
      { trigger: { id: "excluded" }, eventId: "excluded", eventSlug: "hook", config: { ...f.config, conditions: leaf("$.action", "other") } },
      ...["duplicate", "full", "accepted"].map(id => ({ trigger: { id }, eventId: id, eventSlug: "hook", config: f.config })),
    ]);
    f.invoke.mockResolvedValueOnce({ duplicate: true } as any).mockRejectedValueOnce(new InvocationError("queue_full", "full")).mockResolvedValueOnce({ duplicate: false } as any);
    await (f.ordinary as any).invoke("github", "delivery", f.payload, "pull_request");
    expect(f.event.mock.calls.map(call => call[4])).toEqual(["conditions_error", "excluded", "duplicate", "queue_full", "accepted"]);
  });
  it("checks scope before conditions and queues GitHub verification before filtering", async () => {
    const f = fixture({ all: [] });
    await (f.ordinary as any).invoke("github", "delivery", { ...f.payload, repository: { id: 99 } }, "pull_request");
    expect(f.event.mock.calls[0][4]).toBe("ignored"); expect(f.invoke).not.toHaveBeenCalled();
    await f.ordinary.github(f.payload, "delivery", "pull_request");
    expect(f.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO app.pending_verifications"))).toBe(true); expect(f.fetch).not.toHaveBeenCalled();
  });
  it("uses latest conditions when a pending verification is evaluated", async () => {
    const f = fixture(leaf("$.pull_request.mergeable", true));
    f.row.event_config = { ...f.config, conditions: leaf("$.pull_request.mergeable", false) };
    await (f.scheduler as any).githubVerifications(); expect(f.invoke).toHaveBeenCalledOnce();
  });
  it("never invokes on evaluation error or disabled/removed events", async () => {
    for (const update of [{ event_config: { ...fixture().config, conditions: { all: [] } } }, { event_enabled: false }, { trigger_enabled: false }, { removed_at: new Date() }]) {
      vi.restoreAllMocks(); const f = fixture(); Object.assign(f.row, update);
      await (f.scheduler as any).githubVerifications(); expect(f.invoke).not.toHaveBeenCalled();
      if (!("event_config" in update)) expect(f.fetch).not.toHaveBeenCalled();
    }
  });
  it("preserves unresolved mergeability retries, open/main gates and queue outcomes", async () => {
    for (const pull of [{ state: "closed", base: { ref: "main" }, mergeable: false }, { state: "open", base: { ref: "feature" }, mergeable: false }, { state: "open", base: { ref: "main" }, mergeable: true }, { state: "open", base: { ref: "main" }, mergeable: null }, { state: "open", base: { ref: "main" }, mergeable: undefined }]) {
      vi.restoreAllMocks(); const f = fixture(); f.fetch.mockResolvedValue(Response.json(pull)); await (f.scheduler as any).githubVerifications(); expect(f.invoke).not.toHaveBeenCalled();
      if (pull.mergeable === null || pull.mergeable === undefined) expect(f.query.mock.calls.some(([sql]) => sql.includes("UPDATE app.pending_verifications SET attempt"))).toBe(true);
    }
    for (const outcome of ["duplicate", "queue_full"]) {
      vi.restoreAllMocks(); const f = fixture();
      if (outcome === "duplicate") f.invoke.mockResolvedValue({ duplicate: true } as any); else f.invoke.mockRejectedValue(new InvocationError("queue_full", "full"));
      await (f.scheduler as any).githubVerifications();
      expect(f.query.mock.calls.some(([sql, values]: any) => sql.includes("INSERT INTO app.trigger_events") && values.includes(outcome))).toBe(true);
    }
  });
});
