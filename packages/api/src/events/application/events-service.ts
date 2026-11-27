import type { readEnrichmentRuns, readOccurrenceStates } from "../storage/event-read-model";
import type { OAuthProps } from "../../types";
import type { AGENT_SCOPES } from "../../access-tokens";
import type { authorizeEnrichment } from "./event-enrichment";
import { enrichmentRun } from "../api/event-enrichment-contracts";
import type { readOccurrenceSummaries } from "../storage/occurrence-summary-repository";
import { eventOccurrenceSummaryPage, parseOccurrenceSummaryCursor } from "../api/event-contracts";

import { type ReadEventOccurrencesInput } from "../../subscriptions/api/mcp-event-contracts";

import { z } from "zod";

import { type EventDefinitionRepository, EventDefinitionConflict } from "../storage/event-definition-repository";

import { parseOccurrenceCursor, eventDefinitionInput, eventDefinitionUpdate, eventDefinitionResponse, eventDefinitionList, eventOccurrencePage } from "../api/event-contracts";

import { ServiceError, publicValue } from "../../service-contract";

export class EventsService {
  constructor(private deps: {
    definitions: () => Pick<EventDefinitionRepository, "list" | "get" | "create" | "update" | "delete" | "occurrences" | "occurrence" | "recordedOccurrences" | "deliveryDiagnostics">;
    authorize: (scope: (typeof AGENT_SCOPES)[number]) => Promise<void>;
    authorizeEnrichment: (config: Parameters<typeof authorizeEnrichment>[2]) => ReturnType<typeof authorizeEnrichment>;
    readEnrichmentRuns: (id: string) => ReturnType<typeof readEnrichmentRuns>;
    readOccurrenceStates: (ids: string[]) => ReturnType<typeof readOccurrenceStates>;
    readSummaries: (id: string, limit: number, cursor?: [string, string]) => ReturnType<typeof readOccurrenceSummaries>;
    authMethod: OAuthProps["authMethod"];
  }) {}
  private occurrenceSummaryBoundary(id: string, cursor?: string) { if (cursor === undefined) return undefined; const result = parseOccurrenceSummaryCursor(cursor, id); if (!result) throw new ServiceError(400, "invalid_request", "Cursor does not match this occurrence history."); return result; }
  async listEvents() { await this.deps.authorize("triggers:read"); return publicValue(eventDefinitionList, await this.deps.definitions().list()); }

  async getEvent(id: string) { await this.deps.authorize("triggers:read"); const event = await this.deps.definitions().get(id); if (!event) throw new ServiceError(404, "not_found", "Event not found"); return publicValue(eventDefinitionResponse, event); }

  async createEvent(input: unknown) { await this.deps.authorize("triggers:write"); const parsed = eventDefinitionInput.parse(input); return publicValue(eventDefinitionResponse, await this.deps.definitions().create({ ...parsed, evaluatorAuthority: parsed.enrichment ? await this.deps.authorizeEnrichment(parsed.enrichment) : undefined })); }

  async updateEvent(id: string, input: unknown) { await this.deps.authorize("triggers:write"); const parsed = eventDefinitionUpdate.parse(input); try { const result = await this.deps.definitions().update(id, { ...parsed, evaluatorAuthority: parsed.enrichment ? await this.deps.authorizeEnrichment(parsed.enrichment) : undefined }, parsed.expectedRevision); if (!result) throw new ServiceError(404, "not_found", "Event not found"); return publicValue(eventDefinitionResponse, result); } catch (error) { if (error instanceof EventDefinitionConflict) throw new ServiceError(409, "stale_event", "Event changed since it was loaded."); throw error; } }

  async deleteEvent(id: string) { await this.deps.authorize("triggers:write"); if (!await this.deps.definitions().delete(id)) throw new ServiceError(404, "not_found", "Event not found"); return { id, deleted: true as const }; }

  async listEnrichmentRuns(id: string) {
    await this.deps.authorize("triggers:read");
    if (!await this.deps.definitions().get(id)) throw new ServiceError(404,"not_found","Event not found");
    const rows = await this.deps.readEnrichmentRuns(id);
    return publicValue(z.array(enrichmentRun),rows.map(row=>({id:row.id,triggerId:row.trigger_id,createdAt:row.created_at.toISOString(),
      state:row.state,stage:row.stage,reason:row.reason,steps:row.steps,input:row.normalized_input})));
  }

  async listEventOccurrenceSummaries(id: string, limit: number, cursor?: string) {
    await this.deps.authorize("triggers:read");
    id = id.toLowerCase();
    const result = await this.deps.readSummaries(id, limit, this.occurrenceSummaryBoundary(id, cursor));
    if (!result) throw new ServiceError(404, "not_found", "Event not found");
    return publicValue(eventOccurrenceSummaryPage, result);
  }

  async listEventOccurrences(id: string, limit: number, cursor?: string) { await this.deps.authorize("triggers:read"); const result = await this.deps.definitions().occurrences(id, limit, cursor); if (!result) throw new ServiceError(404, "not_found", "Event not found"); return publicValue(eventOccurrencePage, result); }

  async readEventOccurrences(input: ReadEventOccurrencesInput) {
    await this.deps.authorize("triggers:read");
    const repository = this.deps.definitions();
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
    if (this.deps.authMethod === "vm") throw new ServiceError(403, "owner_required", "An owner credential is required.");
    await this.deps.authorize("triggers:read");
    const result = await this.deps.definitions().deliveryDiagnostics(occurrenceId);
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
    await this.deps.authorize("triggers:read");
    if (!eventIds.length) return [];
    return this.deps.readOccurrenceStates(eventIds);
  }
}
