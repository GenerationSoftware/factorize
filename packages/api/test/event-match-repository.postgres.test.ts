import { describe, expect, it, vi } from "vitest";
import { EventMatchRepository, validAgainstSchema } from "../src/postgres/event-match-repository";
import { loadingFixture } from "./helpers/loading-fixture";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, WorkflowEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));

const url = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!url)("durable Event occurrences", () => {
  it("validates payloads, supports multiple Triggers per Event, deduplicates deliveries, and scopes reads by tenant", async () => {
    const f = await loadingFixture(url!);
    try {
      const triggerId = f.triggerIds[0];
      const definitionId = (await f.db.pool.query("SELECT event_definition_id FROM app.triggers WHERE tenant_id=$1 AND id=$2", [f.tenantId, triggerId])).rows[0].event_definition_id as string;
      await f.db.pool.query(`UPDATE app.event_definition_revisions SET payload_schema=$3
        WHERE tenant_id=$1 AND definition_id=$2 AND revision=1`, [f.tenantId, definitionId, { type: "object", required: ["value"], properties: { value: { type: "number" } }, additionalProperties: false }]);
      expect(() => validAgainstSchema({ value: "bad" }, { type: "object", properties: { value: { type: "number" } } })).toThrow("must be number");
      const matches = new EventMatchRepository(f.db);
      const { EventDefinitionRepository } = await import("../src/postgres/event-definition-repository");
      const definitions = new EventDefinitionRepository(f.db, f.tenantId);
      const firstInput = { tenantId: f.tenantId, triggerId, triggerRevision: 1, sourceIdentity: "fixture:delivery-1", deduplicationKey: "delivery-1", evidence: { value: 7 }, decision: "matched" as const };
      const first = await matches.match(firstInput);
      expect(first.occurrence).toMatchObject({ definitionId, payload: { value: 7 } });
      const duplicate = await matches.match(firstInput);
      expect(duplicate).toMatchObject({ duplicate: true, occurrence: { id: first.occurrence!.id } });
      await expect(matches.match({ ...firstInput, sourceIdentity: "fixture:bad", deduplicationKey: "bad", evidence: { value: "bad" } })).rejects.toThrow("must be number");

      const siblingId = crypto.randomUUID();
      await f.db.pool.query("INSERT INTO app.triggers(tenant_id,id,event_definition_id,name,slug) VALUES($1,$2,$3,'Sibling','sibling')", [f.tenantId, siblingId, definitionId]);
      const sibling = await matches.match({ ...firstInput, triggerId: siblingId, sourceIdentity: "fixture:delivery-1", deduplicationKey: "delivery-1" });
      expect(sibling.occurrence?.definitionId).toBe(definitionId);
      expect(sibling).toMatchObject({ duplicate: true, occurrence: { id: first.occurrence?.id } });
      const otherDefinition = await definitions.create({ name: "orders.processed" });
      const otherTriggerId = crypto.randomUUID();
      await f.db.pool.query("INSERT INTO app.triggers(tenant_id,id,event_definition_id,name,slug) VALUES($1,$2,$3,'Other Event','other-event')", [f.tenantId, otherTriggerId, otherDefinition!.id]);
      const otherEvent = await matches.match({ ...firstInput, triggerId: otherTriggerId });
      expect(otherEvent).toMatchObject({ duplicate: false, occurrence: { definitionId: otherDefinition!.id } });
      const foreignDefinitionId = (await f.db.pool.query("SELECT event_definition_id FROM app.triggers WHERE tenant_id=$1 AND id=$2", [f.otherTenant, triggerId])).rows[0].event_definition_id as string;
      const foreignMatch = await matches.match({ ...firstInput, tenantId: f.otherTenant });
      expect(foreignMatch).toMatchObject({ duplicate: false, occurrence: { definitionId: foreignDefinitionId } });

      expect((await definitions.occurrences(definitionId))?.items[0]?.id).toBe(first.occurrence!.id);
      const foreignDefinitions = new EventDefinitionRepository(f.db, f.otherTenant);
      expect(await foreignDefinitions.occurrences(definitionId)).toBeNull();
    } finally { await f.cleanup(); }
  });
});
