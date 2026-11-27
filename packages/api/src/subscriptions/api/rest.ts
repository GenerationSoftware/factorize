import { subscriptionOccurrenceSummaryPage, occurrenceSummaryQuery } from "../../events/api/event-contracts";

import { z } from "zod";

import { eventSubscription, eventSubscriptionId, eventSubscriptionList } from "../../events/api/event-contracts";

import { route, jsonSchema, type RouteContract } from "../../transport/rest/route-contract";

export const subscriptionRoutes = [
  route("GET", "/api/v1/event-subscriptions", "triggers:read", {
    summary: "List the signed-in owner's Event subscriptions in the current workspace",
    description: "Shows registration lifecycle, not current delivery capability. Does not expose webhook configuration.",
    responses: { "200": { description: "Event subscriptions", content: { "application/json": { schema: jsonSchema(eventSubscriptionList, "output") } } } },
  }, service => service.listDashboardEventSubscriptions(), { ownerSession: true }),
  route("GET", "/api/v1/event-subscriptions/{subscriptionId}", "triggers:read", {
    summary: "Get a signed-in owner's Event subscription in the current workspace",
    responses: { "200": { description: "Event subscription", content: { "application/json": { schema: jsonSchema(eventSubscription, "output") } } }, "404": { description: "Event subscription not found" } },
  }, (service, { params }) => service.getDashboardEventSubscription(params.subscriptionId),
  { ownerSession: true, parameters: z.object({ subscriptionId: eventSubscriptionId }) }),
  route("GET", "/api/v1/event-subscriptions/{subscriptionId}/occurrences", "triggers:read", {
    summary: "List matched occurrences for the signed-in owner's exact subscription",
    description: "Newest first. HTTP acceptance confirms receipt, not processing. Acknowledgment is independent. Webhook configuration and payloads are omitted.",
    responses: {
      "200": { description: "Subscription occurrence summaries", content: { "application/json": { schema: jsonSchema(subscriptionOccurrenceSummaryPage, "output") } } },
      "404": { description: "Event subscription not found" },
    },
  }, (service, { params, query }) => service.listSubscriptionOccurrences(params.subscriptionId, query.limit, query.cursor),
  { ownerSession: true, parameters: z.object({ subscriptionId: eventSubscriptionId }), query: occurrenceSummaryQuery }),
] satisfies RouteContract[];
