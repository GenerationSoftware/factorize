import { queryOptions } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { messageOf } from "../auth/session";
export const targetsQuery = queryOptions({ queryKey: ["editor", "targets"], queryFn: async ({ signal }) => {
  const { data, error } = await api.GET("/api/v1/execution-targets", { signal });
  if (!data || error) throw new Error(messageOf(error)); return data;
}, staleTime: 60_000 });
export const metadataQuery = queryOptions({ queryKey: ["editor", "templates"], queryFn: async ({ signal }) => {
  const { data, error } = await api.GET("/api/v1/trigger-contexts", { signal });
  if (!data || error) throw new Error(messageOf(error)); return data;
}, staleTime: 300_000 });
export const availabilityQuery = queryOptions({ queryKey: ["editor", "availability"], queryFn: async ({ signal }) => {
  const { data, error } = await api.GET("/api/v1/job-trigger-availability", { signal });
  if (!data || error) throw new Error(messageOf(error)); return data;
}, staleTime: 60_000 });
export const selectorQuery = (q: string, cursor?: string) => queryOptions({ queryKey: ["jobs", "selector", q, cursor], queryFn: async ({ signal }) => {
  const { data, error } = await api.GET("/api/v1/job-selector", { signal, params: { query: { q, cursor, limit: 30 } } });
  if (!data || error) throw new Error(messageOf(error)); return data;
}, staleTime: 30_000 });
