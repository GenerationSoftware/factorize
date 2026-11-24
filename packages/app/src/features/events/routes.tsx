import { createRoute, lazyRouteComponent, redirect, type AnyRootRoute } from "@tanstack/react-router";
import { sessionQuery } from "../auth/session";
import { queryClient } from "../../shared/query-client";

export function eventRoutes(root: AnyRootRoute) {
  const guard = async ({ location }: { location: { href: string } }) => {
    if (!(await queryClient.ensureQueryData(sessionQuery)).authenticated) {
      throw redirect({ to: "/auth/login", search: { returnTo: location.href, token: undefined } });
    }
  };
  return [
    createRoute({ getParentRoute: () => root, path: "/events", beforeLoad: guard,
      component: lazyRouteComponent(() => import("./events"), "EventsPage") }),
    createRoute({ getParentRoute: () => root, path: "/events/subscriptions", beforeLoad: guard,
      component: lazyRouteComponent(() => import("./events"), "SubscriptionsPage") }),
    createRoute({ getParentRoute: () => root, path: "/events/subscriptions/$subscriptionId", beforeLoad: guard,
      component: lazyRouteComponent(() => import("./events"), "SubscriptionPage") }),
    createRoute({ getParentRoute: () => root, path: "/events/$eventId", beforeLoad: guard,
      component: lazyRouteComponent(() => import("./events"), "EventPage") }),
  ];
}
