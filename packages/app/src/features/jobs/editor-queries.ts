import { queryOptions } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { messageOf } from "../auth/session";
export const targetsQuery = queryOptions({ queryKey: ["editor", "integrations"], queryFn: async ({ signal }) => {
  const { data, error } = await api.GET("/api/v1/integrations", { signal });
  if (!data || error) throw new Error(messageOf(error));
  return [...data.exeConnections.map(connection => ({ id: connection.connectionId, name: "exe.dev", kind: "exe" as const, agentKind: "codex", efforts: ["minimal", "low", "medium", "high", "xhigh"] as string[] })), ...data.ampConnections.map(connection => ({ id: `amp:${connection.connectionId}`, name: `Amp · ${connection.project}`, kind: "amp" as const, agentKind: "Amp", efforts: [] as string[] }))];
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
