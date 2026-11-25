import { createRoute, lazyRouteComponent, redirect, type AnyRootRoute } from "@tanstack/react-router";
import { queryClient } from "../../shared/query-client";
import { sessionQuery } from "../auth/session";
import { vmGrantsQuery } from "./queries";

export function workloadRoutes(root: AnyRootRoute) {
  const beforeLoad = async ({ location }: { location: { href: string } }) => {
    const session = await queryClient.ensureQueryData(sessionQuery);
    if (!session.authenticated) {
      throw redirect({ to: "/auth/login", search: { returnTo: location.href } });
    }
    return { canReadWorkloads: session.capabilities.includes("vms:read") };
  };
  const loader = ({ context, preload }: { context: { canReadWorkloads: boolean }; preload: boolean }) => {
    if (context.canReadWorkloads && !preload) void queryClient.prefetchQuery(vmGrantsQuery);
  };
  return [
    createRoute({ getParentRoute: () => root, path: "/workloads", beforeLoad, loader,
      component: lazyRouteComponent(() => import("./workloads"), "WorkloadsPage") }),
    createRoute({ getParentRoute: () => root, path: "/workloads/$workloadId", beforeLoad, loader,
      component: lazyRouteComponent(() => import("./workloads"), "WorkloadPage") }),
    createRoute({ getParentRoute: () => root, path: "/vms", beforeLoad: ({ location }) => {
      throw redirect({ to: "/workloads", search: location.search, hash: location.hash, replace: true });
    } }),
  ];
}
