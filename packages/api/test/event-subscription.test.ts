import { afterEach, describe, expect, it, vi } from "vitest";
import { listenForEvents } from "../src/event-subscription";
import { createMcpHandler } from "@modelcontextprotocol/server";

vi.mock("@modelcontextprotocol/server", () => ({
  createMcpHandler: vi.fn(() => ({
    fetch: async () => new Response("stream", { headers: { "content-type": "text/event-stream" } }),
    notify: { resourceUpdated: vi.fn() }, close: vi.fn(async () => {}),
  })),
}));

afterEach(() => vi.useRealTimers());
describe("MCP Event subscriptions", () => {
  it("notifies subscribed clients when a durable occurrence changes", async () => {
    vi.useFakeTimers();
    const id = "11111111-1111-4111-8111-111111111111", uri = `factorize://events/${id}/occurrences`;
    let reads = 0; let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const service = { eventOccurrenceStates: vi.fn(async () => [{ definition_id: id, id: ++reads === 1 ? "old" : "new" }]) } as any;
    const abort = new AbortController();
    const ctx = { waitUntil(value: Promise<unknown>) { void value.then(finish); } } as any;
    const response = await listenForEvents(new Request("https://factorize.test/mcp", { signal: abort.signal }), { params: { notifications: { resourceSubscriptions: [uri] } } }, service, () => ({}) as any, async () => true, ctx);
    expect(response.headers.get("content-type")).toMatch(/text\/event-stream/);
    await vi.advanceTimersByTimeAsync(1000);
    expect(service.eventOccurrenceStates.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(vi.mocked(createMcpHandler).mock.results[0].value.notify.resourceUpdated).toHaveBeenCalledWith(uri);
    abort.abort();
    await vi.advanceTimersByTimeAsync(1000);
    await pending;
  });
});
