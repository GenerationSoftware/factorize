import { createRoute, lazyRouteComponent, redirect, type AnyRootRoute } from "@tanstack/react-router";
import { sessionQuery } from "../auth/session";
import { queryClient } from "../../shared/query-client";
export function settingsRoutes(root: AnyRootRoute) {
  const guard = async ({ location }: { location: { href: string } }) => { if (!(await queryClient.ensureQueryData(sessionQuery)).authenticated) throw redirect({ to: "/auth/login", search: { returnTo: location.href, token: undefined } }); };
  return [createRoute({ getParentRoute: () => root, path: "/settings/integrations", beforeLoad: guard, component: lazyRouteComponent(() => import("./integrations"), "Integrations") }), createRoute({ getParentRoute: () => root, path: "/settings", beforeLoad: guard, component: lazyRouteComponent(() => import("./integrations"), "Integrations") }),
    createRoute({ getParentRoute: () => root, path: "/settings/api-keys", beforeLoad: guard, component: lazyRouteComponent(() => import("./api-keys"), "ApiKeys") }),
    createRoute({ getParentRoute: () => root, path: "/settings/authorized-clients", beforeLoad: guard, component: lazyRouteComponent(() => import("./authorized-clients"), "AuthorizedClients") })];
}
