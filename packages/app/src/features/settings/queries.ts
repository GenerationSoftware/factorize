import { queryOptions } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { messageOf } from "../auth/session";
export const integrationsQuery = queryOptions({ queryKey: ["settings", "integrations"], queryFn: async ({ signal }) => { const { data, error } = await api.GET("/api/v1/integrations", { signal }); if (!data || error) throw new Error(messageOf(error)); return data; }, staleTime: 30_000 });
export const tokensQuery = queryOptions({ queryKey: ["settings", "tokens"], queryFn: async ({ signal }) => { const { data, error } = await api.GET("/api/v1/access-tokens", { signal }); if (!data || error) throw new Error(messageOf(error)); return data; }, staleTime: 30_000 });
export const clientsQuery = queryOptions({ queryKey: ["settings", "clients"], queryFn: async ({ signal }) => { const { data, error } = await api.GET("/api/v1/access/authorized-clients", { signal }); if (!data || error) throw new Error(messageOf(error)); return data; }, staleTime: 30_000 });
