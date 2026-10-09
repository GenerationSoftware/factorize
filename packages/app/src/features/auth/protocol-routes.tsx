import { createRoute, lazyRouteComponent, redirect, type AnyRootRoute } from "@tanstack/react-router";
import { queryClient } from "../../shared/query-client";
import { sessionQuery } from "./session";
export function protocolRoutes(root: AnyRootRoute) {
  const guard = async ({ location }: { location: { href: string } }) => { if (!(await queryClient.ensureQueryData(sessionQuery)).authenticated) throw redirect({ to: "/auth/login", search: { returnTo: location.href, token: undefined } }); };
  return [createRoute({ getParentRoute: () => root, path: "/authorize", beforeLoad: guard, component: lazyRouteComponent(() => import("./consent"), "ConsentScreen") }),
    createRoute({ getParentRoute: () => root, path: "/device", beforeLoad: guard, validateSearch: (s: Record<string, unknown>) => ({ user_code: typeof s.user_code === "string" ? s.user_code.slice(0, 32) : "" }), component: lazyRouteComponent(() => import("./device"), "DeviceScreen") })];
}
