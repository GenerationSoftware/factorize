import { api } from "factorize-api-client";
import { queryOptions } from "@tanstack/react-query";
import { messageOf } from "../auth/session";
export type JobsSort = "running" | "title";
export type JobsOrder = "asc" | "desc";
export type JobsSearch = { q: string; cursor?: string; enabled?: "true" | "false"; sort?: JobsSort; order?: JobsOrder };
export const jobsQuery = (search: JobsSearch) => queryOptions({
  queryKey: ["jobs", "summaries", { q: search.q, enabled: search.enabled, sort: search.sort, order: search.order }],
  queryFn: async ({ signal }) => {
    // The API's UUID pages do not reflect running/title order. Collect lightweight
    // summaries before paginating so active jobs on later API pages come first.
    const items = [];
    let cursor: string | undefined;
    do {
      const { data, error } = await api.GET("/api/v1/job-summaries", { signal, params: { query: { q: search.q, enabled: search.enabled, cursor, limit: 100 } } });
      if (!data || error) throw new Error(messageOf(error));
      items.push(...data.items);
      cursor = data.nextCursor ?? undefined;
    } while (cursor);
    items.sort((a, b) => {
      if (!search.sort) return Number(b.runningCount > 0) - Number(a.runningCount > 0) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
      const direction = search.order === "desc" ? -1 : 1;
      const comparison = search.sort === "running"
        ? a.runningCount - b.runningCount
        : a.name.localeCompare(b.name);
      return direction * comparison || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    });
    return items;
  },
  select: items => {
    const cursorIndex = search.cursor ? items.findIndex(job => job.id === search.cursor) : -1;
    const start = cursorIndex + 1;
    const page = items.slice(start, start + 30);
    return { items: page, nextCursor: start + 30 < items.length ? page.at(-1)!.id : null };
  }, staleTime: 10_000,
});
export const jobQuery = (jobId: string) => queryOptions({
  queryKey: ["jobs", "detail", jobId],
  queryFn: async ({ signal }) => {
    const { data, error } = await api.GET("/api/v1/jobs/{jobId}", { signal, params: { path: { jobId } } });
    if (!data || error) throw new Error(messageOf(error)); return data;
  }, staleTime: 10_000,
});
