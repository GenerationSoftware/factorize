import { validAgainstSchema } from "../src/events/domain/event-match";
import { describe, expect, it, vi } from "vitest";
import { EventMatchRepository } from "../src/events/storage/event-match-repository";
import { loadingFixture } from "./helpers/loading-fixture";
import { ApiService } from "../src/api-service";
import { inspectOAuthGrant, scopesForOAuthCredential } from "../src/mcp-oauth-auth";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, WorkflowEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));

const url = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!url)("durable Event occurrences", () => {
  it("applies connection permission edits within each OAuth credential’s scope limit", async () => {
    const f = await loadingFixture(url!);
    try {
      const grantId = "scope-grant";
      const now = Math.floor(Date.now()/1000);
      const integrationId = crypto.randomUUID();
      await f.db.pool.query("INSERT INTO app.agent_integrations(tenant_id,id,kind,credential_id,name,available,policy,epoch) VALUES($1,$2,'bearer','test-secret','Test integration',true,'requestable',1)",[f.tenantId,integrationId]);
      const integrationScope = `integration:${integrationId}:1`;
      const readOnly = ["triggers:read"];
      const readWrite = [...readOnly,"triggers:write","proxy:use",integrationScope];
      f.env.OAUTH_PROVIDER = { listUserGrants: async () => ({items:[{id:grantId,clientId:"test-client",metadata:{tenantId:f.tenantId},scope:readWrite,createdAt:now,expiresAt:null}]}), lookupClient: async () => ({clientId:"test-client",clientName:"Test client"}) } as any;
      const service = new ApiService(f.env,f.auth);
      const auth = {...f.auth,authMethod:"oauth" as const,oauthGrantId:grantId};
      const effective = async (credential: string[]) => scopesForOAuthCredential(credential, await inspectOAuthGrant(f.db.pool, auth, grantId));
      await service.access.updateClientPermissions(grantId,{scopes:readWrite,expectedRevision:0});
      expect(await effective(readOnly)).toEqual(readOnly);
      expect(await effective(readWrite)).toEqual(readWrite);
      await service.access.updateClientPermissions(grantId,{scopes:readOnly,expectedRevision:1});
      expect(await effective(readOnly)).toEqual(readOnly);
      expect(await effective(readWrite)).toEqual(readOnly);
      await service.access.updateClientPermissions(grantId,{scopes:readWrite,expectedRevision:2});
      expect(await effective(readWrite)).toEqual(readOnly);
    } finally { await f.cleanup(); }
  });
  it("deletes an Event with its Triggers, input sources, match state, and occurrence history", async () => {
    const f = await loadingFixture(url!);
    try {
      const { triggerId, definitionId } = await f.seedEventTrigger();
      const { definitionId: foreignDefinitionId } = await f.seedEventTrigger(f.otherTenant, triggerId);
      const schedule = (await f.db.pool.query("SELECT id FROM app.events WHERE tenant_id=$1 AND trigger_id=$2 AND kind='schedule'", [f.tenantId,triggerId])).rows[0];
      await f.db.pool.query("INSERT INTO app.schedule_state(tenant_id,event_id,trigger_id,next_run_at) VALUES($1,$2,$3,now())", [f.tenantId,schedule.id,triggerId]);
      await new EventMatchRepository(f.db).match({tenantId:f.tenantId,triggerId,triggerRevision:1,sourceIdentity:"fixture:delete",deduplicationKey:"delete",evidence:{value:1},decision:"matched"});
      const service = new ApiService(f.env,f.auth);
      await expect(service.events.deleteEvent(definitionId)).resolves.toEqual({id:definitionId,deleted:true});
      expect((await f.db.pool.query("SELECT count(*)::int AS count FROM app.triggers WHERE tenant_id=$1 AND id=$2",[f.tenantId,triggerId])).rows[0].count).toBe(0);
      expect((await f.db.pool.query("SELECT count(*)::int AS count FROM app.events WHERE tenant_id=$1 AND trigger_id=$2",[f.tenantId,triggerId])).rows[0].count).toBe(0);
      expect((await f.db.pool.query("SELECT count(*)::int AS count FROM app.schedule_state WHERE tenant_id=$1 AND trigger_id=$2",[f.tenantId,triggerId])).rows[0].count).toBe(0);
      expect((await f.db.pool.query("SELECT count(*)::int AS count FROM app.trigger_matches WHERE tenant_id=$1 AND trigger_id=$2",[f.tenantId,triggerId])).rows[0].count).toBe(0);
      expect((await f.db.pool.query("SELECT count(*)::int AS count FROM app.event_occurrences WHERE tenant_id=$1 AND definition_id=$2",[f.tenantId,definitionId])).rows[0].count).toBe(0);
      expect((await f.db.pool.query("SELECT count(*)::int AS count FROM app.event_definition_revisions WHERE tenant_id=$1 AND definition_id=$2",[f.tenantId,definitionId])).rows[0].count).toBe(0);
      expect((await f.db.pool.query("SELECT count(*)::int AS count FROM app.event_definitions WHERE tenant_id=$1 AND id=$2",[f.tenantId,definitionId])).rows[0].count).toBe(0);
      expect((await f.db.pool.query("SELECT count(*)::int AS count FROM app.event_definitions WHERE tenant_id=$1 AND id=$2",[f.otherTenant,foreignDefinitionId])).rows[0].count).toBe(1);
    } finally { await f.cleanup(); }
  });
  it("validates payloads, supports multiple Triggers per Event, deduplicates deliveries, and scopes reads by tenant", async () => {
    const f = await loadingFixture(url!);
    try {
      const { triggerId, definitionId } = await f.seedEventTrigger();
      const { definitionId: foreignDefinitionId } = await f.seedEventTrigger(f.otherTenant, triggerId);
      await f.db.pool.query(`UPDATE app.event_definition_revisions SET payload_schema=$3
        WHERE tenant_id=$1 AND definition_id=$2 AND revision=1`, [f.tenantId, definitionId, { type: "object", required: ["value"], properties: { value: { type: "number" } }, additionalProperties: false }]);
      expect(() => validAgainstSchema({ value: "bad" }, { type: "object", properties: { value: { type: "number" } } })).toThrow("must be number");
      const matches = new EventMatchRepository(f.db);
      const { EventDefinitionRepository } = await import("../src/events/storage/event-definition-repository");
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
      const foreignMatch = await matches.match({ ...firstInput, tenantId: f.otherTenant });
      expect(foreignMatch).toMatchObject({ duplicate: false, occurrence: { definitionId: foreignDefinitionId } });

      expect((await definitions.occurrences(definitionId))?.items[0]?.id).toBe(first.occurrence!.id);
      const foreignDefinitions = new EventDefinitionRepository(f.db, f.otherTenant);
      expect(await foreignDefinitions.occurrences(definitionId)).toBeNull();
    } finally { await f.cleanup(); }
  });
});
