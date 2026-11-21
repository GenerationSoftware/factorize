import { createRoute, lazyRouteComponent, redirect, type AnyRootRoute } from "@tanstack/react-router";
import { queryClient } from "../../shared/query-client";
import { sessionQuery } from "../auth/session";

export function vmRoutes(root: AnyRootRoute) {
  const beforeLoad = async ({ location }: { location: { href: string } }) => {
    if (!(await queryClient.ensureQueryData(sessionQuery)).authenticated)
      throw redirect({ to: "/auth/login", search: { returnTo: location.href, token: undefined } });
  };
  return [
    createRoute({ getParentRoute: () => root, path: "/vms", beforeLoad,
      component: lazyRouteComponent(() => import("./attachments"), "VmsPage") }),
    createRoute({ getParentRoute: () => root, path: "/clients", beforeLoad,
      component: lazyRouteComponent(() => import("../settings/authorized-clients"), "ClientsPage") }),
    createRoute({ getParentRoute: () => root, path: "/clients/$grantId", beforeLoad,
      component: lazyRouteComponent(() => import("../settings/authorized-clients"), "ClientPage") }),
  ];
}
