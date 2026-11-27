import { readEnrichmentRuns, readOccurrenceStates } from "../storage/event-read-model";
import type { Env, OAuthProps } from "../../types";
import type { AGENT_SCOPES } from "../../access-tokens";
import { authorizeEnrichment } from "./event-enrichment";
import { enrichmentRun } from "../api/event-enrichment-contracts";
import { readOccurrenceSummaries } from "../storage/occurrence-summary-repository";
import { eventOccurrenceSummaryPage, parseOccurrenceSummaryCursor } from "../api/event-contracts";

import { type ReadEventOccurrencesInput } from "../../mcp-event-contracts";

import { z } from "zod";

import { databaseFor } from "../../postgres/database";

import { EventDefinitionRepository, EventDefinitionConflict } from "../storage/event-definition-repository";

import { parseOccurrenceCursor, eventDefinitionInput, eventDefinitionUpdate, eventDefinitionResponse, eventDefinitionList, eventOccurrencePage } from "../api/event-contracts";

import { ServiceError, publicValue } from "../../service-contract";

export class EventsService {
  constructor(private env: Env, private auth: OAuthProps, private authorize: (scope: (typeof AGENT_SCOPES)[number]) => Promise<void>) {}
  private eventDefinitions() { return new EventDefinitionRepository(databaseFor(this.env), this.auth.tenantId); }
  private occurrenceSummaryBoundary(id: string, cursor?: string) { if (cursor === undefined) return undefined; const result = parseOccurrenceSummaryCursor(cursor, id); if (!result) throw new ServiceError(400, "invalid_request", "Cursor does not match this occurrence history."); return result; }
  async listEvents() { await this.authorize("triggers:read"); return publicValue(eventDefinitionList, await this.eventDefinitions().list()); }

  async getEvent(id: string) { await this.authorize("triggers:read"); const event = await this.eventDefinitions().get(id); if (!event) throw new ServiceError(404, "not_found", "Event not found"); return publicValue(eventDefinitionResponse, event); }

  async createEvent(input: unknown) { await this.authorize("triggers:write"); const parsed = eventDefinitionInput.parse(input); return publicValue(eventDefinitionResponse, await this.eventDefinitions().create({ ...parsed, evaluatorAuthority: parsed.enrichment ? await authorizeEnrichment(this.env,this.auth,parsed.enrichment) : undefined })); }

  async updateEvent(id: string, input: unknown) { await this.authorize("triggers:write"); const parsed = eventDefinitionUpdate.parse(input); try { const result = await this.eventDefinitions().update(id, { ...parsed, evaluatorAuthority: parsed.enrichment ? await authorizeEnrichment(this.env,this.auth,parsed.enrichment) : undefined }, parsed.expectedRevision); if (!result) throw new ServiceError(404, "not_found", "Event not found"); return publicValue(eventDefinitionResponse, result); } catch (error) { if (error instanceof EventDefinitionConflict) throw new ServiceError(409, "stale_event", "Event changed since it was loaded."); throw error; } }

  async deleteEvent(id: string) { await this.authorize("triggers:write"); if (!await this.eventDefinitions().delete(id)) throw new ServiceError(404, "not_found", "Event not found"); return { id, deleted: true as const }; }

  async listEnrichmentRuns(id: string) {
    await this.authorize("triggers:read");
    if (!await this.eventDefinitions().get(id)) throw new ServiceError(404,"not_found","Event not found");
    const rows = await readEnrichmentRuns(databaseFor(this.env), this.auth.tenantId, id);
    return publicValue(z.array(enrichmentRun),rows.map(row=>({id:row.id,triggerId:row.trigger_id,createdAt:row.created_at.toISOString(),
      state:row.state,stage:row.stage,reason:row.reason,steps:row.steps,input:row.normalized_input})));
  }

  async listEventOccurrenceSummaries(id: string, limit: number, cursor?: string) {
    await this.authorize("triggers:read");
    id = id.toLowerCase();
    const result = await readOccurrenceSummaries(databaseFor(this.env), this.auth.tenantId,
      { kind: "event", id }, limit, this.occurrenceSummaryBoundary(id, cursor));
    if (!result) throw new ServiceError(404, "not_found", "Event not found");
    return publicValue(eventOccurrenceSummaryPage, result);
  }

  async listEventOccurrences(id: string, limit: number, cursor?: string) { await this.authorize("triggers:read"); const result = await this.eventDefinitions().occurrences(id, limit, cursor); if (!result) throw new ServiceError(404, "not_found", "Event not found"); return publicValue(eventOccurrencePage, result); }

  async readEventOccurrences(input: ReadEventOccurrencesInput) {
    await this.authorize("triggers:read");
    const repository = this.eventDefinitions();
    if ("occurrenceId" in input) {
      const occurrence = await repository.occurrence(input.occurrenceId);
      if (!occurrence) throw new ServiceError(404, "not_found", "Event occurrence not found.");
      return { items: [occurrence], nextCursor: null };
    }

    const definitionId = input.definitionId.toLowerCase();
    const cursor = input.cursor ? parseOccurrenceCursor(input.cursor, definitionId, input.since) : null;
    if (input.cursor !== undefined && !cursor) throw new ServiceError(400, "invalid_request", "Cursor does not match the Event definition and since time.");
    if (!await repository.get(definitionId)) throw new ServiceError(404, "not_found", "Event not found.");
    return repository.recordedOccurrences(definitionId, input.since, input.limit, cursor ? [cursor[2], cursor[3]] : undefined);
  }

  async readEventDeliveryDiagnostics(occurrenceId: string) {
    if (this.auth.authMethod === "vm") throw new ServiceError(403, "owner_required", "An owner credential is required.");
    await this.authorize("triggers:read");
    const result = await this.eventDefinitions().deliveryDiagnostics(occurrenceId);
    if (!result) throw new ServiceError(404, "not_found", "Event occurrence not found.");
    return result;
  }

  async mcpReadEvent(uri: string) {
    let parsed: URL; try { parsed = new URL(uri); } catch { throw new ServiceError(400, "invalid_resource", "Expected a Factorize Event resource URI."); }
    if (parsed.protocol !== "factorize:" || parsed.hostname !== "events" || !/^\/[0-9a-f-]{36}\/occurrences$/.test(parsed.pathname)) throw new ServiceError(400, "invalid_resource", "Expected a Factorize Event occurrence URI.");
    const eventId = parsed.pathname.split("/")[1];
    const page = await this.listEventOccurrences(eventId, 100);
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(page) }] };
  }

  async eventOccurrenceStates(eventIds: string[]) {
    await this.authorize("triggers:read");
    if (!eventIds.length) return [];
    return readOccurrenceStates(databaseFor(this.env), this.auth.tenantId, eventIds);
  }
}
