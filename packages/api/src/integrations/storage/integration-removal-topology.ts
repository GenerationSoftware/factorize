import Mustache from "mustache";
import type { EventEnrichment } from "../../events/api/event-enrichment-contracts";
import type { DatabaseClient } from "../../postgres/database";

export type IntegrationTopologyTarget = { kind: string; id: string; registrationId?: string | null };
type Source = { id: string; triggerId: string; triggerName: string; eventId: string; eventName: string; sourceName: string; deleteTrigger: boolean };
type Lookup = { eventId: string; eventName: string; name: string; cascaded: boolean };
type Paused = { id: string; name: string };
export type IntegrationTopology = { sources: Source[]; lookups: Lookup[]; pausedEvents: Paused[]; versions: string[] };

export async function lockIntegrationTopology(sql: DatabaseClient, tenantId: string) {
  await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`integration-topology:${tenantId}`]);
}

// The renderer accepts flat Mustache name tokens only. Use its parser rather
// than matching literal path text or accidentally including cross-name prefixes.
function consumesRemovedLookup(path: string, removed: Set<string>) {
  return Mustache.parse(path).some(token => token[0] === "name" && token[1].startsWith("lookups.") &&
    removed.has(token[1].split(".")[1]));
}
export function removedLookupSteps(enrichment: EventEnrichment, registrationId: string) {
  const removed = new Set(enrichment.extraDataUrls.filter(step => step.integration === registrationId).map(step => step.name));
  for (let previous = -1; previous !== removed.size;) {
    previous = removed.size;
    for (const step of enrichment.extraDataUrls) if (consumesRemovedLookup(step.path, removed)) removed.add(step.name);
  }
  return enrichment.extraDataUrls.filter(step => removed.has(step.name)).map(step => ({ name: step.name, cascaded: step.integration !== registrationId }));
}

export async function inspectIntegrationTopology(sql: DatabaseClient, tenantId: string, target: IntegrationTopologyTarget): Promise<IntegrationTopology> {
  const provider = target.kind === "github" ? "github" : target.kind === "cloudflareTail" ? "cloudflareTail" : null;
  const sources: Source[] = [];
  const lookups: Lookup[] = [];
  const pausedEvents: Paused[] = [];
  const versions: string[] = [];
  if (provider) {
    const { rows } = await sql.query<Omit<Source, "deleteTrigger"> & { revision: number; remaining: number; active: boolean }>(`
      SELECT s.id,t.id AS "triggerId",t.name AS "triggerName",d.id AS "eventId",d.name AS "eventName",s.slug AS "sourceName",t.revision,(t.enabled AND s.enabled AND s.config->>'provider' <> 'cloudflareTail') AS active,
        (SELECT count(*)::int FROM app.events other WHERE other.tenant_id=t.tenant_id AND other.trigger_id=t.id AND other.removed_at IS NULL) AS remaining
      FROM app.events s JOIN app.triggers t ON (t.tenant_id,t.id)=(s.tenant_id,s.trigger_id)
      JOIN app.event_definitions d ON (d.tenant_id,d.id)=(t.tenant_id,t.event_definition_id)
      WHERE s.tenant_id=$1 AND s.removed_at IS NULL AND s.kind='webhook' AND s.config->>'provider'=$2
        AND s.config->>(CASE WHEN $2='github' THEN 'installationId' ELSE 'integrationId' END)=$3
      ORDER BY t.id,s.id`, [tenantId, provider, target.id]);
    const counts = new Map<string,number>();
    for (const row of rows) counts.set(row.triggerId, (counts.get(row.triggerId) ?? 0)+1);
    for (const {revision,remaining,active: _active,...row} of rows) {
      versions.push(`trigger:${row.triggerId}:${revision}`);
      sources.push({...row,deleteTrigger:(counts.get(row.triggerId) ?? 0) === remaining});
    }
    const activeEvents = [...new Set(rows.filter(row=>row.active).map(row=>row.eventId))];
    if (activeEvents.length) {
      const stopped = await sql.query<Paused & {current_revision:number}>(`
        SELECT d.id,d.name,d.current_revision FROM app.event_definitions d WHERE d.tenant_id=$1 AND d.id=ANY($2::uuid[])
          AND NOT EXISTS(
            SELECT 1 FROM app.triggers t JOIN app.events s ON (s.tenant_id,s.trigger_id)=(t.tenant_id,t.id)
            WHERE t.tenant_id=d.tenant_id AND t.event_definition_id=d.id AND t.enabled
              AND s.enabled AND s.removed_at IS NULL AND (s.config->>'provider') IS DISTINCT FROM 'cloudflareTail'
              AND NOT(s.id=ANY($3::uuid[]))
          ) ORDER BY d.id`, [tenantId,activeEvents,sources.map(row=>row.id)]);
      for (const {current_revision,...event} of stopped.rows) {
        pausedEvents.push(event);
        versions.push(`event:${event.id}:${current_revision}`);
      }
    }
  }
  if (target.registrationId) {
    const { rows } = await sql.query<{id:string;name:string;current_revision:number;enrichment:EventEnrichment}>(`
      SELECT d.id,d.name,d.current_revision,r.enrichment FROM app.event_definitions d JOIN app.event_definition_revisions r
        ON (r.tenant_id,r.definition_id,r.revision)=(d.tenant_id,d.id,d.current_revision)
      WHERE d.tenant_id=$1 AND r.enrichment->'extraDataUrls' @> jsonb_build_array(jsonb_build_object('integration',$2::text))
      ORDER BY d.id`, [tenantId,target.registrationId]);
    for (const row of rows) {
      const steps = removedLookupSteps(row.enrichment,target.registrationId);
      if (!steps.length) continue;
      versions.push(`event:${row.id}:${row.current_revision}`);
      lookups.push(...steps.map(step => ({ eventId:row.id,eventName:row.name,...step })));
      if (!pausedEvents.some(event=>event.id===row.id)) pausedEvents.push({id:row.id,name:row.name});
    }
  }
  return { sources, lookups, pausedEvents, versions:[...new Set(versions)].sort() };
}

// Event matching reads Trigger before Event. Removal takes the same order,
// before locking any credential rows that an in-flight evaluation may need.
export async function lockIntegrationTopologyRows(sql: DatabaseClient, tenantId:string, impact:IntegrationTopology) {
  const triggerIds=[...new Set(impact.sources.map(source=>source.triggerId))].sort();
  const eventIds=[...new Set(impact.pausedEvents.map(event=>event.id))].sort();
  if (triggerIds.length) await sql.query("SELECT id FROM app.triggers WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",[tenantId,triggerIds]);
  if (eventIds.length) await sql.query("SELECT id FROM app.event_definitions WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",[tenantId,eventIds]);
}

export async function applyIntegrationTopology(sql: DatabaseClient, tenantId: string, impact: IntegrationTopology) {
  for (const triggerId of new Set(impact.sources.map(row => row.triggerId))) {
    const sources = impact.sources.filter(row => row.triggerId === triggerId);
    await sql.query("SELECT id FROM app.triggers WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId,triggerId]);
    await sql.query("DELETE FROM app.pending_verifications WHERE tenant_id=$1 AND event_id=ANY($2::uuid[])", [tenantId,sources.map(row=>row.id)]);
    await sql.query("DELETE FROM app.events WHERE tenant_id=$1 AND trigger_id=$2 AND id=ANY($3::uuid[])", [tenantId,triggerId,sources.map(row=>row.id)]);
    if (sources[0].deleteTrigger) {
      await sql.query("DELETE FROM app.triggers WHERE tenant_id=$1 AND id=$2 AND NOT EXISTS(SELECT 1 FROM app.events WHERE tenant_id=$1 AND trigger_id=$2 AND removed_at IS NULL)", [tenantId,triggerId]);
    } else {
      await sql.query("UPDATE app.triggers SET revision=revision+1,updated_at=greatest(clock_timestamp(),updated_at+interval '1 millisecond') WHERE tenant_id=$1 AND id=$2", [tenantId,triggerId]);
    }
  }
  for (const event of impact.pausedEvents) {
    const names = impact.lookups.filter(row => row.eventId === event.id).map(row => row.name);
    if (!names.length) continue; // Source-only stop is derived, not an enrichment pause.
    await sql.query("SELECT id FROM app.event_definitions WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId,event.id]);
    await sql.query(`INSERT INTO app.event_definition_revisions
      (tenant_id,definition_id,revision,payload_schema,enrichment,evaluator_authority,enrichment_pause_reason)
      SELECT r.tenant_id,r.definition_id,r.revision+1,r.payload_schema,
        jsonb_set(r.enrichment,'{extraDataUrls}',coalesce((SELECT jsonb_agg(step ORDER BY ordinal)
          FROM jsonb_array_elements(r.enrichment->'extraDataUrls') WITH ORDINALITY AS steps(step,ordinal)
          WHERE NOT (step->>'name'=ANY($3::text[]))),'[]'::jsonb)),r.evaluator_authority,'integration_removed'
      FROM app.event_definition_revisions r JOIN app.event_definitions d
        ON (d.tenant_id,d.id,d.current_revision)=(r.tenant_id,r.definition_id,r.revision)
      WHERE d.tenant_id=$1 AND d.id=$2`, [tenantId,event.id,names]);
    await sql.query("UPDATE app.event_definitions SET current_revision=current_revision+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2", [tenantId,event.id]);
  }
}

export class IntegrationTopologyChanged extends Error {}

export async function validateEnrichmentRegistrations(sql: DatabaseClient, tenantId:string, enrichment: EventEnrichment | null | undefined) {
  const ids = [...new Set(enrichment?.extraDataUrls.map(step=>step.integration) ?? [])];
  if (!ids.length) return;
  const result = await sql.query("SELECT id FROM app.agent_integrations WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND available AND policy<>'disabled'",[tenantId,ids]);
  if (result.rowCount !== ids.length) throw new IntegrationTopologyChanged("An Event lookup integration is no longer available.");
}

export async function validateTopologySources(sql:DatabaseClient, tenantId:string, sources: {id:string;kind:string;config:Record<string,unknown>}[], existing: {id:string;config:Record<string,unknown>}[]) {
  const previous = new Map(existing.map(row=>[row.id,row.config]));
  for (const source of sources) {
    if (source.kind !== "webhook") continue;
    const old = previous.get(source.id);
    if (source.config.provider === "cloudflareTail" &&
        (old?.provider !== "cloudflareTail" || old.integrationId !== source.config.integrationId)) {
      throw new IntegrationTopologyChanged("The retired Cloudflare Tail source was removed.");
    }
    if (source.config.provider !== "github" || (old?.provider === "github" && old.installationId === source.config.installationId)) continue;
    const result = await sql.query("SELECT installation_id FROM app.github_installations WHERE tenant_id=$1 AND installation_id=$2",[tenantId,source.config.installationId]);
    if (!result.rowCount) throw new IntegrationTopologyChanged("The Trigger's GitHub installation is no longer available.");
  }
}
