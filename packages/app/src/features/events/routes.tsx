import { createRoute, lazyRouteComponent, redirect, type AnyRootRoute } from "@tanstack/react-router";
import { sessionQuery } from "../auth/session";
import { queryClient } from "../../shared/query-client";
export function eventRoutes(root: AnyRootRoute) {
  return createRoute({ getParentRoute: () => root, path: "/events",
    beforeLoad: async ({ location }) => { if (!(await queryClient.ensureQueryData(sessionQuery)).authenticated) throw redirect({ to: "/auth/login", search: { returnTo: location.href, token: undefined } }); },
    component: lazyRouteComponent(() => import("./events"), "EventsPage"),
  });
}
