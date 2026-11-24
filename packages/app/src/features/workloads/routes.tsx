import { createRoute, lazyRouteComponent, redirect, type AnyRootRoute } from "@tanstack/react-router";
import { queryClient } from "../../shared/query-client";
import { sessionQuery } from "../auth/session";

export function workloadRoutes(root: AnyRootRoute) {
  const beforeLoad = async ({ location }: { location: { href: string } }) => {
    if (!(await queryClient.ensureQueryData(sessionQuery)).authenticated) {
      throw redirect({ to: "/auth/login", search: { returnTo: location.href } });
    }
  };
  return [
    createRoute({ getParentRoute: () => root, path: "/workloads", beforeLoad,
      component: lazyRouteComponent(() => import("./workloads"), "WorkloadsPage") }),
    createRoute({ getParentRoute: () => root, path: "/workloads/$workloadId", beforeLoad,
      component: lazyRouteComponent(() => import("./workloads"), "WorkloadPage") }),
    createRoute({ getParentRoute: () => root, path: "/vms", beforeLoad: ({ location }) => {
      throw redirect({ to: "/workloads", search: location.search, hash: location.hash, replace: true });
    } }),
  ];
}
