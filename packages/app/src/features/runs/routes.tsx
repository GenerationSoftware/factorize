import { createRoute, lazyRouteComponent, redirect, type AnyRootRoute } from "@tanstack/react-router";
import { sessionQuery } from "../auth/session";
import { queryClient } from "../../shared/query-client";
import { runStatusQuery } from "./queries";
export function runRoutes(root: AnyRootRoute) {
  return [createRoute({ getParentRoute: () => root, path: "/job-runs/$runId",
    validateSearch: (s: Record<string, unknown>) => ({ after: Number.isSafeInteger(Number(s.after)) && Number(s.after) >= 0 ? Number(s.after) : 0 }),
    beforeLoad: async ({ location }) => { if (!(await queryClient.ensureQueryData(sessionQuery)).authenticated) throw redirect({ to: "/auth/login", search: { returnTo: location.href, token: undefined } }); },
    loader: ({ params }) => queryClient.ensureQueryData(runStatusQuery(params.runId)),
    component: lazyRouteComponent(() => import("./detail"), "RunDetail"),
  })];
}
