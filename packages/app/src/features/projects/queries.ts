import { api } from "factorize-api-client";
import { queryOptions } from "@tanstack/react-query";
import { messageOf } from "../auth/session";
export const projectsQuery = queryOptions({ queryKey: ["projects"], queryFn: async ({ signal }) => { const { data, error } = await api.GET("/api/v1/projects", { signal }); if (!data || error) throw new Error(messageOf(error)); return data; }, staleTime: 10_000 });
export const projectQuery = (projectId: string) => queryOptions({ queryKey: ["projects", projectId], queryFn: async ({ signal }) => { const { data, error } = await api.GET("/api/v1/projects/{projectId}", { signal, params: { path: { projectId } } }); if (!data || error) throw new Error(messageOf(error)); return data; }, staleTime: 10_000 });
