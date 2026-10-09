import { api } from "factorize-api-client";
import { queryOptions } from "@tanstack/react-query";
import { messageOf } from "../auth/session";
export type JobsSearch = { q: string; cursor?: string; enabled?: "true" | "false" };
export const jobsQuery = (search: JobsSearch) => queryOptions({
  queryKey: ["jobs", "summaries", search],
  queryFn: async ({ signal }) => {
    const { data, error } = await api.GET("/api/v1/job-summaries", { signal, params: { query: { ...search, limit: 30 } } });
    if (!data || error) throw new Error(messageOf(error)); return data;
  }, staleTime: 10_000,
});
export const jobQuery = (jobId: string) => queryOptions({
  queryKey: ["jobs", "detail", jobId],
  queryFn: async ({ signal }) => {
    const { data, error } = await api.GET("/api/v1/jobs/{jobId}", { signal, params: { path: { jobId } } });
    if (!data || error) throw new Error(messageOf(error)); return data;
  }, staleTime: 10_000,
});
