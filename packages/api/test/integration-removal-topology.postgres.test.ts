import { expect, it } from "vitest";
import type { EventEnrichment } from "../src/events/api/event-enrichment-contracts";
import { EventDefinitionRepository } from "../src/events/storage/event-definition-repository";
import { EventMatchRepository } from "../src/events/storage/event-match-repository";
import { applyIntegrationTopology, inspectIntegrationTopology, IntegrationTopologyChanged, lockIntegrationTopology, removedLookupSteps } from "../src/postgres/integration-removal-topology";
import { loadingFixture } from "./helpers/loading-fixture";

const url = process.env.AUTH_TEST_DATABASE_URL;
function config(remove: string, keep: string): EventEnrichment {
  return { rule:"lookups.samples.ok == `true`", extraDataUrls:[
    {name:"seed",integration:remove,method:"GET",path:"/resources/{{input.key}}"},
    {name:"read",integration:keep,method:"GET",path:"/objects/{{lookups.seed.id}}"},
    {name:"samples",integration:keep,method:"GET",path:"/objects?name={{lookups.read.id}}"},
    {name:"keep",integration:keep,method:"GET",path:"/lookups.seed.literal"},
  ] };
}

it("removes exact lookup IDs and all dependent steps, not matching literal text",()=>{
  const remove=crypto.randomUUID(), keep=crypto.randomUUID();
  expect(removedLookupSteps(config(remove,keep),remove)).toEqual([
    {name:"seed",cascaded:false},{name:"read",cascaded:true},{name:"samples",cascaded:true},
  ]);
});

it.skipIf(!url)("removes exact sources, pauses sensitive Event revisions, and preserves retained tenant data",async()=>{
  const f=await loadingFixture(url!);
  try {
    const retained=await f.seedEventTrigger(), other=await f.seedEventTrigger(f.otherTenant);
    const events = new EventDefinitionRepository(f.db,f.tenantId);
    const sole = (await events.create({name:"only-source"}))!;
    const soleTrigger=crypto.randomUUID(), retainedSource=crypto.randomUUID(), soleSource=crypto.randomUUID(), otherSource=crypto.randomUUID();
    await f.db.pool.query("INSERT INTO app.triggers(tenant_id,id,event_definition_id,name,slug) VALUES($1,$2,$3,'only','only')",[f.tenantId,soleTrigger,sole.id]);
    for(const [tenant,id,trigger] of [[f.tenantId,retainedSource,retained.triggerId],[f.tenantId,soleSource,soleTrigger],[f.otherTenant,otherSource,other.triggerId]])
      await f.db.pool.query(`INSERT INTO app.events(tenant_id,id,trigger_id,kind,slug,position,config)
        VALUES($1,$2,$3,'webhook','pulls',5,'{"provider":"github","installationId":111,"repositoryId":2,"event":"check_suite","action":"completed"}')`,[tenant,id,trigger]);
    const prior=await new EventMatchRepository(f.db).match({tenantId:f.tenantId,triggerId:retained.triggerId,triggerRevision:1,sourceIdentity:"manual:retained",deduplicationKey:"original",evidence:{keep:true},decision:"matched"});
    const remove=crypto.randomUUID(), keep=crypto.randomUUID();
    await f.db.pool.query("INSERT INTO app.agent_integrations(tenant_id,id,kind,credential_id,name,available) VALUES($1,$2,'github','111','Fixture',true),($1,$3,'bearer','fixture','Retained',true)",[f.tenantId,remove,keep]);
    const enrichment=config(remove,keep);
    await events.update(retained.definitionId,{name:"fixture-event",enrichment},1);
    const impact=await f.db.transaction(async sql=>{
      await lockIntegrationTopology(sql,f.tenantId);
      const preview=await inspectIntegrationTopology(sql,f.tenantId,{kind:"github",id:"111",registrationId:remove});
      await applyIntegrationTopology(sql,f.tenantId,preview);
      await sql.query("DELETE FROM app.agent_integrations WHERE tenant_id=$1 AND id=$2",[f.tenantId,remove]);
      return preview;
    });
    expect(impact.sources).toEqual(expect.arrayContaining([expect.objectContaining({id:retainedSource,deleteTrigger:false}),expect.objectContaining({id:soleSource,deleteTrigger:true})]));
    expect(impact.sources).toHaveLength(2);
    expect(impact.pausedEvents.map(row=>row.id)).toEqual(expect.arrayContaining([retained.definitionId,sole.id]));
    expect(impact.lookups.map(row=>row.name)).toEqual(["seed","read","samples"]);
    expect(await events.get(retained.definitionId)).toMatchObject({revision:3,enrichment:{rule:enrichment.rule,extraDataUrls:[enrichment.extraDataUrls[3]]},enrichmentPauseReason:"integration_removed"});
    expect(await events.get(sole.id)).toMatchObject({revision:1});
    expect((await f.db.pool.query("SELECT id FROM app.events WHERE id=$1",[otherSource])).rowCount).toBe(1);
    expect((await f.db.pool.query("SELECT id FROM app.triggers WHERE id=$1",[soleTrigger])).rowCount).toBe(0);
    expect((await events.occurrences(retained.definitionId))?.items[0].id).toBe(prior.occurrence!.id);
    await expect(events.update(retained.definitionId,{name:"fixture-event",enrichment},3)).rejects.toBeInstanceOf(IntegrationTopologyChanged);
    await events.update(retained.definitionId,{name:"fixture-event"},3);
    expect(await events.get(retained.definitionId)).toMatchObject({enrichmentPauseReason:"integration_removed"});
    const paused=await new EventMatchRepository(f.db).match({tenantId:f.tenantId,triggerId:retained.triggerId,triggerRevision:2,sourceIdentity:"manual:retained",deduplicationKey:"paused",evidence:{},decision:"matched"});
    expect(paused).toMatchObject({outcome:"failed",occurrence:null,evaluationId:expect.any(String)});
    expect((await f.db.pool.query("SELECT reason FROM app.event_enrichment_runs WHERE id=$1",[paused.evaluationId])).rows[0].reason).toBe("integration_removed");
    await events.update(retained.definitionId,{name:"fixture-event",enrichment:null},4);
    expect((await events.get(retained.definitionId))?.enrichmentPauseReason).toBeUndefined();
  } finally { await f.cleanup(); }
});
