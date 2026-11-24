import { createRoute, lazyRouteComponent, redirect, type AnyRootRoute } from "@tanstack/react-router";
import { sessionQuery } from "../auth/session";
import { queryClient } from "../../shared/query-client";
export function triggersRoutes(root: AnyRootRoute) {
  const beforeLoad = async ({ location }: { location: { href: string } }) => { if (!(await queryClient.ensureQueryData(sessionQuery)).authenticated) throw redirect({ to: "/auth/login", search: { returnTo: location.href, token: undefined } }); };
  return [
    createRoute({ getParentRoute: () => root, path: "/triggers", beforeLoad, component: lazyRouteComponent(() => import("./list"), "TriggerList") }),
    createRoute({ getParentRoute: () => root, path: "/triggers/new", beforeLoad, component: lazyRouteComponent(() => import("./editor"), "TriggerEditor") }),
    createRoute({ getParentRoute: () => root, path: "/triggers/$triggerId", beforeLoad, component: lazyRouteComponent(() => import("./detail"), "TriggerDetail") }),
    createRoute({ getParentRoute: () => root, path: "/triggers/$triggerId/edit", beforeLoad, component: lazyRouteComponent(() => import("./editor"), "TriggerEditor") }),
  ];
}
