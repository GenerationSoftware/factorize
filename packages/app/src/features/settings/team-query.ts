import { api } from "factorize-api-client";
import { messageOf } from "../auth/session";
export const teamQuery = {
  queryKey: ["team"],
  queryFn: async () => {
    const { data, error } = await api.GET("/api/v1/team");
    if (!data || error) throw new Error(messageOf(error));
    return data;
  },
};
