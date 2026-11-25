import { describe, expect, it, vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";

vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {}, WorkflowEntrypoint: class {}, DurableObject: class {},
}));
vi.mock("@cloudflare/workers-oauth-provider", () => ({
  OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn(),
}));

describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("Events list on PostgreSQL", () => {
  it("returns independent workspace counts, including empty counts and historical revisions", async () => {
    const f = await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);
    try {
      const add = async (tenantId: string, id: string, name: string, triggers: number, occurrences: number) => {
        await f.db.pool.query(`INSERT INTO app.event_definitions (tenant_id,id,name,current_revision)
          VALUES ($1,$2,$3,2)`, [tenantId, id, name]);
        await f.db.pool.query(`INSERT INTO app.event_definition_revisions
          (tenant_id,definition_id,revision,payload_schema) VALUES ($1,$2,1,'{"type":"object"}'),
          ($1,$2,2,'{"type":"object","additionalProperties":false}')`, [tenantId, id]);
        await f.db.pool.query(`INSERT INTO app.triggers (tenant_id,id,event_definition_id,name,slug,enabled)
          SELECT $1,gen_random_uuid(),$2,$3 || '-' || n,$3 || '-' || n,n <> 2
          FROM generate_series(1,$4::int) n`, [tenantId, id, name, triggers]);
        await f.db.pool.query(`INSERT INTO app.event_occurrences
          (tenant_id,id,definition_id,definition_revision,payload,producer_identity,source_identity,idempotency_key)
          SELECT $1,gen_random_uuid(),$2,CASE WHEN n=1 THEN 1 ELSE 2 END,'{}','{}',$3,n::text
          FROM generate_series(1,$4::int) n`, [tenantId, id, name, occurrences]);
      };
      const shared = crypto.randomUUID();
      await add(f.tenantId, shared, "populated", 2, 3);
      await add(f.tenantId, crypto.randomUUID(), "triggers-only", 1, 0);
      await add(f.tenantId, crypto.randomUUID(), "occurrences-only", 0, 1);
      await add(f.tenantId, crypto.randomUUID(), "empty", 0, 0);
      await add(f.otherTenant, shared, "other-tenant", 4, 5);

      const response = await f.request("/api/v1/events");
      expect(response.status).toBe(200);
      const events = await response.json() as Array<Record<string, unknown>>;
      expect(events.map(({ name, triggerCount, occurrenceCount }) => [name, triggerCount, occurrenceCount]))
        .toEqual([["empty", 0, 0], ["occurrences-only", 0, 1], ["populated", 2, 3], ["triggers-only", 1, 0]]);
      expect(events[2]).toMatchObject({
        id: shared, revision: 2, payloadSchema: { type: "object", additionalProperties: false },
      });
    } finally {
      await f.cleanup();
    }
  });
});
