import { api } from "factorize-api-client";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { messageOf } from "../auth/session";
import type { RunStatus } from "../../shared/ui";
export class RunNotFoundError extends Error {
  constructor() { super("This run is no longer available. It may have expired from retained history."); this.name = "RunNotFoundError"; }
}
function queryError(error: unknown, status?: number): Error {
  return status === 404 ? new RunNotFoundError() : new Error(messageOf(error));
}
export const runStatusQuery = (runId: string) => queryOptions({
  queryKey: ["runs", runId, "status"],
  queryFn: async ({ signal }) => {
    const { data, error, response } = await api.GET("/api/v1/runs/{runId}/status", { signal, params: { path: { runId } } });
    if (!data || error) throw queryError(error, response.status); return data;
  }, retry: (failureCount, error) => !(error instanceof RunNotFoundError) && failureCount < 1, refetchIntervalInBackground: false,
  refetchInterval: query => query.state.error instanceof RunNotFoundError ? false : query.state.data && ["succeeded", "failed", "stopped"].includes(query.state.data.state) && !query.state.data.finalizing ? false : query.state.error ? 10_000 : 2_000,
});
export const runTraceQuery = (runId: string, revision: string, after: number, polling: boolean) => queryOptions({
  queryKey: ["runs", runId, "trace", revision, after],
  queryFn: async ({ signal }) => {
    const { data, error, response } = await api.GET("/api/v1/runs/{runId}/trace-pages", { signal, params: { path: { runId }, query: { revision, after, limit: 100 } } });
    if (!data || error) throw queryError(error, response.status); return data;
  }, retry: (failureCount, error) => !(error instanceof RunNotFoundError) && failureCount < 1, enabled: !!revision, refetchIntervalInBackground: false, refetchInterval: query => query.state.error instanceof RunNotFoundError ? false : polling ? 2_000 : false,
});
export const runDetailQuery = (runId: string) => queryOptions({ queryKey: ["runs", runId, "detail"], queryFn: async ({ signal }) => { const { data, error, response } = await api.GET("/api/v1/runs/{runId}", { signal, params: { path: { runId } } }); if (!data || error) throw queryError(error, response.status); return data; }, retry: (failureCount, error) => !(error instanceof RunNotFoundError) && failureCount < 1, staleTime: 60_000 });
export const diagnosticsQuery = (runId: string) => queryOptions({ queryKey: ["runs", runId, "diagnostics"], queryFn: async ({ signal }) => { const { data, error, response } = await api.GET("/api/v1/runs/{runId}/diagnostics", { signal, params: { path: { runId } } }); if (!data || error) throw queryError(error, response.status); return data; }, retry: (failureCount, error) => !(error instanceof RunNotFoundError) && failureCount < 1, staleTime: 30_000 });
export const runPageQuery = ({ jobId, projectIds, jobIds, cursor, limit, sort, direction, states }: { jobId?: string; projectIds?: string[]; jobIds?: string[]; cursor?: string; limit: number; sort?: "job" | "run" | "status" | "created" | "agent"; direction?: "asc" | "desc"; states?: RunStatus[] }) => queryOptions({
  queryKey: ["runs", "page", jobId, projectIds, jobIds, cursor, limit, sort, direction, states],
  queryFn: async ({ signal }) => { const { data, error } = await api.GET("/api/v1/runs", { signal, params: { query: { jobId: jobIds ?? jobId, projectId: projectIds, cursor, limit, sort, direction, state: states } } }); if (!data || error) throw new Error(messageOf(error)); return data; },
  staleTime: 1_000,
  refetchInterval: query => query.state.error ? 10_000 : query.state.data?.items.some(run => ["queued", "reserved", "starting", "running", "blocked", "stopping"].includes(run.state)) ? 2_000 : 15_000,
  refetchIntervalInBackground: false,
});
export const historyQuery = (jobId: string, cursor?: string, sort?: "run" | "status" | "created" | "agent", direction?: "asc" | "desc", states?: RunStatus[]) => queryOptions({ queryKey: ["runs", "history", jobId, cursor, sort, direction, states], queryFn: async ({ signal }) => { const { data, error } = await api.GET("/api/v1/runs", { signal, params: { query: { jobId, cursor, sort, direction: direction ?? (sort ? "asc" : undefined), state: states, limit: 30 } } }); if (!data || error) throw new Error(messageOf(error)); return data; }, placeholderData: keepPreviousData, staleTime: 0, refetchOnMount: false });
