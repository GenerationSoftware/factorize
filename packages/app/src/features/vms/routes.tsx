import { createRoute, lazyRouteComponent, redirect, type AnyRootRoute } from "@tanstack/react-router";
import { queryClient } from "../../shared/query-client";
import { sessionQuery } from "../auth/session";

export function vmRoute(root: AnyRootRoute) {
  return createRoute({
    getParentRoute: () => root,
    path: "/vms",
    beforeLoad: async () => {
      if (!(await queryClient.ensureQueryData(sessionQuery)).authenticated) {
        throw redirect({ to: "/auth/login", search: { returnTo: "/vms" } });
      }
    },
    component: lazyRouteComponent(() => import("./vms"), "VmsPage"),
  });
}
