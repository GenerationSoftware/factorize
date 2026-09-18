import { afterEach, describe, expect, it, vi } from "vitest";
import { InvocationError, InvocationService } from "../src/job-domain";
import { WebhookService } from "../src/postgres/webhook-service";

afterEach(() => vi.restoreAllMocks());

describe("webhook queue policy", () => {
  function fixture() {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const service = new WebhookService({ pool: { query } } as any, {} as any, "tenant");
    const config = { provider: "github", installationId: 1, repositoryId: 2, event: "issues", action: "opened" };
    vi.spyOn(service as any, "candidates").mockResolvedValue(["full", "available"].map(id => ({ job: { id }, triggerId: id, triggerSlug: "hook", config })));
    vi.spyOn(service as any, "ensure").mockResolvedValue("delivery");
    const event = vi.spyOn(service as any, "event").mockResolvedValue(undefined);
    const payload = { installation: { id: 1 }, repository: { id: 2 }, action: "opened" };
    return { service, event, payload };
  }

  it("acknowledges overflow and continues admitting other matching jobs", async () => {
    const { service, event, payload } = fixture();
    const invoke = vi.spyOn(InvocationService.prototype, "invoke")
      .mockRejectedValueOnce(new InvocationError("queue_full", "Full"))
      .mockResolvedValueOnce({ duplicate: false } as any);
    await expect(service.github(payload, "delivery", "issues")).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(event.mock.calls.map(call => [call[1], call[4]])).toEqual([["full", "queue_full"], ["available", "accepted"]]);
  });

  it("does not swallow unexpected admission failures", async () => {
    const { service, payload } = fixture();
    vi.spyOn(InvocationService.prototype, "invoke").mockRejectedValue(new Error("database unavailable"));
    await expect(service.github(payload, "delivery", "issues")).rejects.toThrow("database unavailable");
  });
});
