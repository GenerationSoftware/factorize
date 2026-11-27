import { describe, expect, it, vi } from "vitest";
import worker from "../src/worker";
import { loadingFixture } from "./helpers/loading-fixture";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, WorkflowEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));

const url = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!url)("Worker public Event and Trigger contract", () => {
  it("publishes one durable occurrence across concurrent retries and requires authentication", async () => {
    const f = await loadingFixture(url!);
    try {
      const { triggerId, definitionId } = await f.seedEventTrigger();
      const path = `/api/v1/triggers/${triggerId}/fire`;
      const body = { idempotencyKey: "refactor-contract", data: { source: "local" } };
      const fire = (cookie?: string) => worker.fetch(new Request(f.env.APP_ORIGIN + path, {
        method: "POST", headers: { "Content-Type": "application/json", Origin: f.env.APP_ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
        body: JSON.stringify(body),
      }), f.env, { waitUntil() {} } as unknown as ExecutionContext);
      expect((await fire()).status).toBe(401);
      const a = await Promise.all([fire(f.cookie), fire(f.cookie)]);
      expect(a.map(r => r.status)).toEqual([200, 200]);
      const results = await Promise.all(a.map(r => r.json() as Promise<{ occurrenceId: string; duplicate: boolean }>));
      expect(results.map(r => r.duplicate).sort()).toEqual([false, true]);
      expect(results[0].occurrenceId).toEqual(results[1].occurrenceId);
      const response = await f.request(`/api/v1/events/${definitionId}/occurrences`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ items: [
        { id: results[0].occurrenceId, revision: 1, payload: body.data },
      ] });
      expect((await f.request(`/api/v1/events/${definitionId}`, "invalid-cookie")).status).toBe(401);
    } finally { await f.cleanup(); }
  });
});
