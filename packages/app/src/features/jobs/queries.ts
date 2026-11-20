import { api } from "factorize-api-client";
import { queryOptions } from "@tanstack/react-query";
import { messageOf } from "../auth/session";
export type TriggersSort = "running" | "title";
export type TriggersOrder = "asc" | "desc";
export type TriggersSearch = { view?: "graph"; q?: string; cursor?: string; enabled?: "true" | "false"; sort?: TriggersSort; order?: TriggersOrder };
export const triggersQuery = (search: TriggersSearch) => queryOptions({
  queryKey: ["triggers", "summaries", { q: search.q ?? "", enabled: search.enabled, cursor: search.cursor, sort: search.sort ?? "active", direction: search.sort === "running" || search.sort === "title" ? search.order ?? "asc" : undefined, limit: 30 }],
  queryFn: async ({ signal }) => {
    const sort = search.sort === "running" ? "running" : search.sort === "title" ? "title" : "active";
    const { data, error } = await api.GET("/api/v1/trigger-summaries", { signal, params: { query: { q: search.q ?? "", enabled: search.enabled, cursor: search.cursor, limit: 30, sort, direction: sort === "active" ? undefined : search.order ?? "asc" } } });
    if (!data || error) throw new Error(messageOf(error));
    return data;
  },
  staleTime: 10_000,
});
export const recentTriggersQuery = queryOptions({ queryKey: ["triggers", "recent"], queryFn: async ({ signal }) => { const { data, error } = await api.GET("/api/v1/trigger-summaries", { signal, params: { query: { limit: 5, sort: "updated", q: "" } } }); if (!data || error) throw new Error(messageOf(error)); return data; }, staleTime: 10_000 });
export const triggerQuery = (triggerId: string) => queryOptions({
  queryKey: ["triggers", "detail", triggerId],
  queryFn: async ({ signal }) => {
    const { data, error } = await api.GET("/api/v1/triggers/{triggerId}", { signal, params: { path: { triggerId } } });
    if (!data || error) throw new Error(messageOf(error)); return data;
  }, staleTime: 10_000,
});
