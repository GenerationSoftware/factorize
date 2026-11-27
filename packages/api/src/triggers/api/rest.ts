import { queryOf } from "../../query-params";

import { eventAvailabilityResponse } from "../../integrations/api/editor-contracts";
import { triggerResponse, triggerUpdateInput } from "../../triggers/api/trigger-contracts";
import { z } from "zod";

import { triggerInputSchema, fireTriggerInputSchema, triggerConditionsTestSchema } from "../../triggers/api/trigger-schemas";

import { route, jsonSchema, type RouteContract } from "../../transport/rest/route-contract";

const deliveryQuery = z.object({
  provider: z.string().optional(),
  deliveryId: z.string().optional(),
  event: z.string().optional(),
  action: z.string().optional(),
  outcome: z.string().optional(),
  triggerId: z.string().optional(),
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const eventQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const scheduleBody = z
  .object({
    cron: z.string().trim().min(1),
    timezone: z.string().trim().min(1),
  })
  .strict();
export const triggerRoutes = [
  route("GET", "/api/v1/event-contexts", "triggers:read", {
    summary: "Get template autocomplete metadata",
    responses: { "200": { description: "Paths by event kind/provider", content: { "application/json": { schema: jsonSchema(z.record(z.string(), z.array(z.object({ path: z.string(), type: z.enum(["string", "number", "boolean", "object", "array", "unknown"]), description: z.string(), example: z.unknown().optional() }))), "output") } } } },
  }, service => service.triggers.eventContextMetadata()),
  route(
    "GET",
    "/api/v1/trigger-event-availability",
    "triggers:read",
    {
      summary: "List available event kinds",
      responses: { "200": { description: "Availability", content: { "application/json": { schema: jsonSchema(eventAvailabilityResponse, "output") } } } },
    },
    (service) => service.triggers.listTriggerEventAvailability(),
  ),
  route(
    "POST",
    "/api/v1/schedules/preview",
    "triggers:read",
    {
      summary: "Preview schedule",
      responses: {
        "200": {
          description: "Next occurrence",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["nextRunAt"],
                properties: {
                  nextRunAt: { type: "string", format: "date-time" },
                },
              },
            },
          },
        },
      },
    },
    (service, { body }) => service.triggers.previewSchedule(body),
    { body: scheduleBody },
  ),
  route(
    "GET",
    "/api/v1/triggers",
    "triggers:read",
    {
      summary: "List triggers",
      responses: {
        "200": {
          description: "Triggers",
          content: {
            "application/json": {
              schema: jsonSchema(z.array(triggerResponse), "output"),
            },
          },
        },
      },
    },
    (service) => service.triggers.listTriggers(),
  ),
  route(
    "POST",
    "/api/v1/triggers",
    "triggers:write",
    { summary: "Create trigger", responses: { "201": { description: "Created", content: { "application/json": { schema: jsonSchema(triggerResponse, "output") } } } } },
    (service, { body }) => service.triggers.createTrigger(body),
    { body: triggerInputSchema },
  ),
  route("POST", "/api/v1/triggers/{triggerId}/fire", "triggers:write", { summary: "Fire a Trigger and create an Event occurrence", responses: { "200": { description: "Event occurrence receipt", content: { "application/json": { schema: jsonSchema(z.object({ occurrenceId: z.uuid().nullable(), duplicate: z.boolean(), evaluationId: z.uuid().optional() }), "output") } } } } }, (service, { params, body }) => service.triggers.fireTrigger(params.triggerId, body), { parameters: z.object({ triggerId: z.uuid() }), body: fireTriggerInputSchema }),
  route(
    "POST",
    "/api/v1/trigger-conditions/test",
    "triggers:write",
    {
      summary: "Test webhook conditions",
      description: "Evaluates supplied prepared webhook context only; does not authenticate the example, route events, verify GitHub state, or invoke triggers.",
      responses: { "200": { description: "Decision", content: { "application/json": { schema: jsonSchema(z.object({ decision: z.enum(["match", "no-match", "error"]), error: z.string().optional(), details: z.array(z.record(z.string(), z.unknown())) }), "output") } } } },
    },
    (service, { body }) => service.triggers.testTriggerConditions(body),
    { body: triggerConditionsTestSchema, maxBodyBytes: 300_000 },
  ),
  route(
    "GET",
    "/api/v1/triggers/{triggerId}/events",
    "triggers:read",
    {
      summary: "List webhook activity",
      responses: {
        "200": {
          description: "Activity",
          content: {
            "application/json": {
              schema: { type: "array", items: { type: "object" } },
            },
          },
        },
      },
    },
    (service, { params, query }) =>
      service.triggers.listTriggerEvents(params.triggerId, query.limit),
    { query: eventQuery },
  ),
  route(
    "POST",
    "/api/v1/triggers/{triggerId}/enable",
    "triggers:write",
    { summary: "Enable trigger", responses: { "200": { description: "Enabled" } } },
    (service, { params }) => service.triggers.setTriggerEnabled(params.triggerId, true),
  ),
  route(
    "POST",
    "/api/v1/triggers/{triggerId}/disable",
    "triggers:write",
    {
      summary: "Disable trigger",
      responses: { "200": { description: "Disabled" } },
    },
    (service, { params }) => service.triggers.setTriggerEnabled(params.triggerId, false),
  ),
  route(
    "GET",
    "/api/v1/triggers/{triggerId}",
    "triggers:read",
    { summary: "Get trigger", responses: { "200": { description: "Trigger", content: { "application/json": { schema: jsonSchema(triggerResponse, "output") } } } } },
    (service, { params }) => service.triggers.getTrigger(params.triggerId),
  ),
  route(
    "PUT",
    "/api/v1/triggers/{triggerId}",
    "triggers:write",
    {
      summary: "Replace trigger",
      description: "Supply expectedUpdatedAt from GET for atomic optimistic concurrency. Stale edits return 409 stale_trigger. Omission uses last-writer-wins updates. Retain each source ID to preserve its identity when its kind stays the same.",
      responses: { "200": { description: "Updated", content: { "application/json": { schema: jsonSchema(triggerResponse, "output") } } }, "409": { description: "stale_trigger: reload and reconcile before retrying" } },
    },
    (service, { params, body }) => service.triggers.updateTrigger(params.triggerId, body),
    { body: triggerUpdateInput },
  ),
  route(
    "DELETE",
    "/api/v1/triggers/{triggerId}",
    "triggers:write",
    { summary: "Delete trigger", responses: { "200": { description: "Deleted" } } },
    (service, { params }) => service.triggers.deleteTrigger(params.triggerId),
  ),
  route(
    "GET",
    "/api/v1/webhooks/deliveries",
    "triggers:read",
    {
      summary: "Search webhook deliveries",
      responses: {
        "200": { description: "Cursor-paginated safe delivery records" },
      },
    },
    (service, { query }) => service.triggers.listWebhookDeliveries(queryOf(query)),
    { query: deliveryQuery },
  ),
  route(
    "GET",
    "/api/v1/webhooks/deliveries/{deliveryId}",
    "triggers:read",
    {
      summary: "Get webhook delivery detail and processing timeline",
      responses: { "200": { description: "Safe delivery detail" } },
    },
    (service, { params }) => service.triggers.getWebhookDelivery(params.deliveryId),
  ),
] satisfies RouteContract[];
