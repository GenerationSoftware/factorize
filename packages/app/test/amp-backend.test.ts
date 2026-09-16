import { describe, expect, it, vi } from "vitest";
import { AmpBackend, mapAmpState } from "../src/amp-backend";

describe("AmpBackend", () => {
  it("maps lifecycle states", () => {
    expect(["starting", "running", "blocked", "stopping", "succeeded", "stopped", "failed"]).toEqual(["provisioning", "working", "waiting_for_input", "cancelling", "completed", "cancelled", "error"].map(mapAmpState));
  });
  it("launches, inspects, and stops without output capability", async () => {
    const responses = [new Response('{"threadId":"T-123","status":"provisioning"}', { status: 201 }), new Response('{"status":"working"}'), new Response('{"status":"cancelled"}')];
    const request: any = vi.fn(async (..._args: any[]) => responses.shift()!);
    const backend = new AmpBackend({ accessToken: "sgamp_secret", project: "acme/repo" }, request as any);
    const launched = await backend.launch({ runId: "run-1", prompt: "Fix it" });
    expect(launched).toMatchObject({ handle: { backendKind: "amp", id: "T-123" }, destinationUrl: "https://ampcode.com/threads/T-123", capabilities: ["stop"] });
    expect(await backend.inspect(launched.handle)).toMatchObject({ state: "running" });
    expect(await backend.stop(launched.handle)).toMatchObject({ state: "stopped" });
    expect(JSON.stringify(launched)).not.toContain("sgamp_secret");
    expect(String(request.mock.calls[0][1].body)).not.toContain("sgamp_secret");
  });
});
