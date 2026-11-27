import { enrichmentRun } from "../../events/api/event-enrichment-contracts";
import { eventOccurrenceSummaryPage, occurrenceSummaryQuery } from "../../events/api/event-contracts";

import { z } from "zod";

import { eventDefinitionInput, eventDefinitionUpdate, eventDefinitionResponse, eventDefinitionList, eventOccurrenceQuery, eventOccurrencePage } from "../../events/api/event-contracts";

import { route, jsonSchema, type RouteContract } from "../../transport/rest/route-contract";

export const eventRoutes = [
  route("GET", "/api/v1/events/{eventId}/occurrence-summaries", "triggers:read", {
    summary: "List bounded, payload-free Event occurrence summaries",
    description: "Newest first, with occurrence IDs and safe source classifications. The full occurrence endpoint is unchanged.",
    responses: {
      "200": { description: "Event occurrence summaries", content: { "application/json": { schema: jsonSchema(eventOccurrenceSummaryPage, "output") } } },
      "404": { description: "Event not found" },
    },
  }, (service, { params, query }) => service.listEventOccurrenceSummaries(params.eventId, query.limit, query.cursor),
  { parameters: z.object({ eventId: z.uuid() }), query: occurrenceSummaryQuery }),
  route("GET", "/api/v1/events", "triggers:read", { summary: "List Events", responses: { "200": { description: "Events and current revisions", content: { "application/json": { schema: jsonSchema(eventDefinitionList, "output") } } } } }, service => service.listEvents()),
  route("POST", "/api/v1/events", "triggers:write", { summary: "Create an Event", responses: { "201": { description: "Created Event", content: { "application/json": { schema: jsonSchema(eventDefinitionResponse, "output") } } } } }, (service, { body }) => service.createEvent(body), { body: eventDefinitionInput }),
  route("GET", "/api/v1/events/{eventId}", "triggers:read", { summary: "Get an Event", responses: { "200": { description: "Event", content: { "application/json": { schema: jsonSchema(eventDefinitionResponse, "output") } } } } }, (service, { params }) => service.getEvent(params.eventId), { parameters: z.object({ eventId: z.uuid() }) }),
  route("PUT", "/api/v1/events/{eventId}", "triggers:write", { summary: "Update an Event payload schema", responses: { "200": { description: "Updated Event", content: { "application/json": { schema: jsonSchema(eventDefinitionResponse, "output") } } } } }, (service, { params, body }) => service.updateEvent(params.eventId, body), { parameters: z.object({ eventId: z.uuid() }), body: eventDefinitionUpdate }),
  route("DELETE", "/api/v1/events/{eventId}", "triggers:write", { summary: "Delete an Event, its Triggers, subscriptions, and occurrences", description:"Permanently deletes the Event, all attached Triggers, their input configurations, subscriptions, and the Event's occurrence history.", responses: { "200": { description: "Deleted" } } }, (service, { params }) => service.deleteEvent(params.eventId), { parameters: z.object({ eventId: z.uuid() }) }),
  route("GET", "/api/v1/events/{eventId}/evaluations", "triggers:read", {
    summary: "Read recent safe Event evaluation diagnostics",
    responses: { "200": { description: "Evaluations", content: { "application/json": { schema: jsonSchema(z.array(enrichmentRun),"output") } } } },
  }, (service,{params})=>service.listEnrichmentRuns(params.eventId), { parameters:z.object({eventId:z.uuid()}) }),
  route("GET", "/api/v1/events/{eventId}/occurrences", "triggers:read", { summary: "List durable Event occurrences", responses: { "200": { description: "Occurrences", content: { "application/json": { schema: jsonSchema(eventOccurrencePage, "output") } } } } }, (service, { params, query }) => service.listEventOccurrences(params.eventId, query.limit, query.cursor), { parameters: z.object({ eventId: z.uuid() }), query: eventOccurrenceQuery }),
] satisfies RouteContract[];
