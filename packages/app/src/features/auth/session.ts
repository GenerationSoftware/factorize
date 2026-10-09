import { api } from "factorize-api-client";
import { queryOptions } from "@tanstack/react-query";
import { queryClient } from "../../shared/query-client";

export const sessionQuery = queryOptions({
  queryKey: ["session"],
  queryFn: async ({ signal }) => {
    const { data, error } = await api.GET("/api/v1/session", { signal });
    if (error || !data) throw new Error("Could not check your session. Please try again.");
    return data;
  },
  staleTime: 10_000,
  refetchInterval: 60_000,
  retry: 1,
});
export async function refreshIdentity() {
  await queryClient.cancelQueries();
  queryClient.clear();
  return queryClient.fetchQuery(sessionQuery);
}
export function messageOf(error: unknown): string {
  if (error && typeof error === "object" && "error" in error) {
    const detail = error.error;
    if (detail && typeof detail === "object" && "message" in detail && typeof detail.message === "string") return detail.message;
  }
  return "Factorize could not complete the request. Please try again.";
}
