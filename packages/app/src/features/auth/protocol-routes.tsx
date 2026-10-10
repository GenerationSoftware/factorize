import { api } from "factorize-api-client";
import { messageOf } from "./session";
import { createRoute, lazyRouteComponent, redirect, type AnyRootRoute } from "@tanstack/react-router";
import { queryClient } from "../../shared/query-client";
import { sessionQuery } from "./session";
export function protocolRoutes(root: AnyRootRoute) {
  const guard = async ({ location }: { location: { href: string; search: Record<string, unknown> } }) => {
    if ((await queryClient.ensureQueryData(sessionQuery)).authenticated) return;
    let connection = typeof location.search.connection === "string" ? location.search.connection : undefined;
    if (!connection) {
      const { data, error } = await api.POST("/api/v1/auth/connections", { body: { returnTo: location.href } });
      if (!data || error) throw new Error(messageOf(error));
      connection = data.connection;
    }
    throw redirect({ to: "/auth/login", search: { connection } });
  };
  return [createRoute({ getParentRoute: () => root, path: "/authorize", beforeLoad: guard, component: lazyRouteComponent(() => import("./consent"), "ConsentScreen") }),
    createRoute({ getParentRoute: () => root, path: "/device", beforeLoad: guard, validateSearch: (s: Record<string, unknown>) => ({ connection: typeof s.connection === "string" ? s.connection : undefined, user_code: typeof s.user_code === "string" ? s.user_code.slice(0, 32) : "" }), component: lazyRouteComponent(() => import("./device"), "DeviceScreen") })];
}
