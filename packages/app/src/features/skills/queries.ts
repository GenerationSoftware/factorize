import { queryOptions } from "@tanstack/react-query";
import { api } from "factorize-api-client";
const message = (error: any) => error?.error?.message ?? "Request failed";
export const skillsQuery = (q = "") => queryOptions({ queryKey: ["skills", "list", q], queryFn: async ({ signal }) => { const result = await api.GET("/api/v1/skills", { params: { query: { q, limit: 100 } }, signal }); if (!result.data || result.error) throw new Error(message(result.error)); return result.data; } });
export const skillQuery = (skillId: string) => queryOptions({ staleTime:60_000, queryKey: ["skills", "detail", skillId], queryFn: async ({signal}) => { const result = await api.GET("/api/v1/skills/{skillId}", { signal, params: { path: { skillId } } }); if (!result.data || result.error) throw new Error(message(result.error)); return result.data; } });
