import { createRoute, lazyRouteComponent, redirect, type AnyRootRoute } from "@tanstack/react-router";
import { queryClient } from "../../shared/query-client";
import { sessionQuery } from "../auth/session";

export function appRoutes(root: AnyRootRoute) {
  const beforeLoad = async ({ location }: { location: { href: string } }) => {
    if (!(await queryClient.ensureQueryData(sessionQuery)).authenticated)
      throw redirect({ to: "/auth/login", search: { returnTo: location.href, token: undefined } });
  };
  return [
    createRoute({ getParentRoute: () => root, path: "/app-consent", beforeLoad,
      validateSearch: (search: Record<string, unknown>) => ({ request: typeof search.request === "string" ? search.request : undefined }),
      component: lazyRouteComponent(() => import("./consent"), "AppConsentPage") }),
    createRoute({ getParentRoute: () => root, path: "/apps", beforeLoad,
      component: lazyRouteComponent(() => import("./index"), "ConnectedAppsPage") }),
    createRoute({ getParentRoute: () => root, path: "/apps/registered", beforeLoad: ({ location }) => {
      throw redirect({ to: "/settings/apps", search: location.search, hash: location.hash, replace: true });
    } }),
    createRoute({ getParentRoute: () => root, path: "/settings/apps", beforeLoad,
      component: lazyRouteComponent(() => import("./index"), "RegisteredAppsPage") }),
  ];
}
