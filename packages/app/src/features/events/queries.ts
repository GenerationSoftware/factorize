import { queryOptions } from "@tanstack/react-query";
import { api, type paths } from "factorize-api-client";

export type EventSubscription = paths["/api/v1/event-subscriptions/{subscriptionId}"]["get"]["responses"][200]["content"]["application/json"];

export const eventsQuery = queryOptions({
  queryKey: ["events", "definitions"],
  queryFn: async ({ signal }) => {
    const { data, error } = await api.GET("/api/v1/events", { signal });
    if (!data || error) throw new Error(error?.error?.message ?? "Could not load Events");
    return data;
  },
  // A route-started request already uses the normal retry policy.
  retryOnMount: false,
});

export const subscriptionsQuery = queryOptions({
  queryKey: ["event-subscriptions"],
  queryFn: async ({ signal }) => {
    const { data, error } = await api.GET("/api/v1/event-subscriptions", { signal });
    if (!data || error) throw new Error(error?.error?.message ?? "Could not load subscriptions");
    return data;
  },
});
