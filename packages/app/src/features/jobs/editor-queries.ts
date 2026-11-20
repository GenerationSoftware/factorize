import { queryOptions } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { messageOf } from "../auth/session";
export const providerConnectionsQuery = queryOptions({ queryKey: ["editor", "provider-connections"], queryFn: async ({ signal }) => {
  const [github, integrations, x] = await Promise.all([api.GET("/api/v1/github-installations", { signal }), api.GET("/api/v1/integrations", { signal }), api.GET("/api/v1/x/connections", { signal })]);
  if (!github.data || github.error) throw new Error(messageOf(github.error));
  if (!integrations.data || integrations.error) throw new Error(messageOf(integrations.error));
  if (!x.data || x.error) throw new Error(messageOf(x.error));
  return { githubInstallations: github.data, linear: integrations.data.linear, xConnections: x.data.connections };
}, staleTime: 60_000 });
export const targetsQuery = queryOptions({ queryKey: ["editor", "integrations"], queryFn: async ({ signal }) => {
  const { data, error } = await api.GET("/api/v1/integrations", { signal });
  if (!data || error) throw new Error(messageOf(error));
  return data.exeConnections.map(connection=>({id:connection.connectionId,name:"exe.dev",kind:"exe" as const,tags:connection.accountTags??[]}));
}, staleTime: 60_000 });
export const metadataQuery = queryOptions({ queryKey: ["editor", "templates"], queryFn: async ({ signal }) => {
  const { data, error } = await api.GET("/api/v1/event-contexts", { signal });
  if (!data || error) throw new Error(messageOf(error)); return data;
}, staleTime: 300_000 });
export const availabilityQuery = queryOptions({ queryKey: ["editor", "availability"], queryFn: async ({ signal }) => {
  const { data, error } = await api.GET("/api/v1/trigger-event-availability", { signal });
  if (!data || error) throw new Error(messageOf(error)); return data;
}, staleTime: 60_000 });
export const selectorQuery = (q: string, cursor?: string) => queryOptions({ queryKey: ["triggers", "selector", q, cursor], queryFn: async ({ signal }) => {
  const { data, error } = await api.GET("/api/v1/trigger-selector", { signal, params: { query: { q, cursor, limit: 30 } } });
  if (!data || error) throw new Error(messageOf(error)); return data;
}, staleTime: 30_000 });
