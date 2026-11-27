import { readEventDeliveryDiagnosticsInput, readEventOccurrencesInput } from "../../subscriptions/api/mcp-event-contracts";

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";

import { z } from "zod";

import { eventDefinitionInput, eventDefinitionUpdate, eventOccurrenceQuery } from "../../events/api/event-contracts";

import { mcpTool } from "../../transport/mcp/tool";
import type { ApiService } from "../../api-service";
import { resourceAction } from "../../transport/mcp/errors";

export function eventsProtocol(server: McpServer, service: ApiService) {
  server.registerResource("event-occurrences",new ResourceTemplate("factorize://events/{eventId}/occurrences",{list:undefined}),{mimeType:"application/json",description:"Durable occurrences of an authorized Factorize Event"},uri=>resourceAction(()=>service.events.mcpReadEvent(uri.href)));
}

export const definitionTools = [
  mcpTool("triggers:read", "list_events", "List Events, their current payload schema revisions, and Trigger and occurrence counts.", z.object({}), service => () => service.events.listEvents()),
  mcpTool("triggers:read", "get_event", "Read an Event and its current payload schema revision.", z.object({eventId:z.uuid()}), service => ({eventId}:any) => service.events.getEvent(eventId)),
  mcpTool("triggers:write", "create_event", "Create a durable Event that one or more Triggers can publish.", eventDefinitionInput, service => (input:any) => service.events.createEvent(input)),
  mcpTool("triggers:read", "list_event_evaluations", "Read recent Event evaluation diagnostics and mapped input, without raw lookup responses.", z.object({eventId:z.uuid()}), service => (input:any) => service.events.listEnrichmentRuns(input.eventId)),
  mcpTool("triggers:write", "update_event", "Create a new Event payload schema revision; existing occurrences retain their original revision.", eventDefinitionUpdate.extend({eventId:z.uuid()}), service => ({eventId,...input}:any) => service.events.updateEvent(eventId,input)),
  mcpTool("triggers:write", "delete_event", "Permanently delete an Event, all its Triggers and input configurations, and its occurrence history.", z.object({eventId:z.uuid()}), service => ({eventId}:any) => service.events.deleteEvent(eventId)),
];

export const occurrenceTools = [
  mcpTool("triggers:read", "read_event_delivery_diagnostics", "Read separate safe HTTP and optional processing diagnostics for one original occurrence ID. A 2xx receipt is not acknowledgment. Does not return payloads or callback details or retry deliveries.", readEventDeliveryDiagnosticsInput, service => ({ occurrenceId }: z.infer<typeof readEventDeliveryDiagnosticsInput>) => service.events.readEventDeliveryDiagnostics(occurrenceId), false, true),
  mcpTool("triggers:read", "read_event_occurrences", "Read committed Event payloads by occurrenceId or by definitionId and an inclusive recorded-time since value. Follow nextCursor with the same definitionId and since. Read recovery wakes by original data.occurrenceId, not their fresh eventId. Reads do not consume history or acknowledge processing; handle out-of-order work by exact ID.", readEventOccurrencesInput, service => (input: z.infer<typeof readEventOccurrencesInput>) => service.events.readEventOccurrences(input), false, true),
  mcpTool("triggers:read", "list_event_occurrences", "Read durable Event occurrences in reverse recorded order, not UUID order. Reads do not acknowledge processing or define a task batch.", z.object({eventId:z.uuid(),...eventOccurrenceQuery.shape}), service => ({eventId,limit,cursor}:any) => service.events.listEventOccurrences(eventId,limit,cursor)),
];
