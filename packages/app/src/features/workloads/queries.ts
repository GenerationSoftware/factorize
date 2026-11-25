import { queryOptions } from "@tanstack/react-query";
import { api, type paths } from "factorize-api-client";
import { messageOf } from "../auth/session";

export type WorkloadGrant = paths["/api/v1/vms"]["get"]["responses"][200]["content"]["application/json"][number];

export const vmGrantsQuery = queryOptions({
  queryKey: ["vm-grants"],
  queryFn: async ({ signal }) => {
    const { data, error } = await api.GET("/api/v1/vms", { signal });
    if (!data || error) throw new Error(messageOf(error));
    return data;
  },
  // A route-started request already uses the normal retry policy.
  retryOnMount: false,
});
