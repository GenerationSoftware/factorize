import { api } from "factorize-api-client";
import { queryOptions } from "@tanstack/react-query";
import { messageOf } from "../auth/session";
export const runStatusQuery = (runId: string) => queryOptions({
  queryKey: ["runs", runId, "status"],
  queryFn: async ({ signal }) => {
    const { data, error } = await api.GET("/api/v1/runs/{runId}/status", { signal, params: { path: { runId } } });
    if (!data || error) throw new Error(messageOf(error)); return data;
  }, retry: 1, refetchIntervalInBackground: false,
  refetchInterval: query => query.state.data && ["succeeded", "failed", "stopped"].includes(query.state.data.state) && !query.state.data.finalizing ? false : query.state.error ? 10_000 : 2_000,
});
export const runTraceQuery = (runId: string, revision: string, after: number, polling: boolean) => queryOptions({
  queryKey: ["runs", runId, "trace", revision, after],
  queryFn: async ({ signal }) => {
    const { data, error } = await api.GET("/api/v1/runs/{runId}/trace-pages", { signal, params: { path: { runId }, query: { revision, after, limit: 100 } } });
    if (!data || error) throw new Error(messageOf(error)); return data;
  }, retry: 1, enabled: !!revision, refetchIntervalInBackground: false, refetchInterval: polling ? 2_000 : false,
});
