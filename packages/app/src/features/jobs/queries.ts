import { api } from "factorize-api-client";
import { queryOptions } from "@tanstack/react-query";
import { messageOf } from "../auth/session";
export type JobsSort = "running" | "title";
export type JobsOrder = "asc" | "desc";
export type JobsSearch = { q?: string; projectId?: string; cursor?: string; enabled?: "true" | "false"; sort?: JobsSort; order?: JobsOrder };
export const jobsQuery = (search: JobsSearch) => queryOptions({
  queryKey: ["jobs", "summaries", { projectId: search.projectId, q: search.q ?? "", enabled: search.enabled, cursor: search.cursor, sort: search.sort ?? "active", direction: search.sort === "running" || search.sort === "title" ? search.order ?? "asc" : undefined, limit: 30 }],
  queryFn: async ({ signal }) => {
    const sort = search.sort === "running" ? "running" : search.sort === "title" ? "title" : "active";
    const { data, error } = await api.GET("/api/v1/job-summaries", { signal, params: { query: { projectId: search.projectId, q: search.q ?? "", enabled: search.enabled, cursor: search.cursor, limit: 30, sort, direction: sort === "active" ? undefined : search.order ?? "asc" } } });
    if (!data || error) throw new Error(messageOf(error));
    return data;
  },
  staleTime: 10_000,
});
export const recentJobsQuery = queryOptions({ queryKey: ["jobs", "recent"], queryFn: async ({ signal }) => { const { data, error } = await api.GET("/api/v1/job-summaries", { signal, params: { query: { limit: 5, sort: "updated", q: "" } } }); if (!data || error) throw new Error(messageOf(error)); return data; }, staleTime: 10_000 });
export const jobQuery = (jobId: string) => queryOptions({
  queryKey: ["jobs", "detail", jobId],
  queryFn: async ({ signal }) => {
    const { data, error } = await api.GET("/api/v1/jobs/{jobId}", { signal, params: { path: { jobId } } });
    if (!data || error) throw new Error(messageOf(error)); return data;
  }, staleTime: 10_000,
});
