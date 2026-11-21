import { createRoute, lazyRouteComponent, redirect, type AnyRootRoute } from "@tanstack/react-router";
import { queryClient } from "../../shared/query-client";
import { sessionQuery } from "../auth/session";

export function appRoutes(root: AnyRootRoute) {
  const beforeLoad = async ({ location }: { location: { href: string } }) => {
    if (!(await queryClient.ensureQueryData(sessionQuery)).authenticated)
      throw redirect({ to: "/auth/login", search: { returnTo: location.href, token: undefined } });
  };
  return [
    createRoute({ getParentRoute: () => root, path: "/apps", beforeLoad,
      component: lazyRouteComponent(() => import("./index"), "ConnectedAppsPage") }),
    createRoute({ getParentRoute: () => root, path: "/apps/registered", beforeLoad,
      component: lazyRouteComponent(() => import("./index"), "RegisteredAppsPage") }),
  ];
}
