import { createRoute, lazyRouteComponent, redirect, type AnyRootRoute } from "@tanstack/react-router";
import { sessionQuery } from "../auth/session";
import { queryClient } from "../../shared/query-client";
import { runPageQuery, runStatusQuery } from "./queries";
export function runRoutes(root: AnyRootRoute) {
  const list = createRoute({ getParentRoute: () => root, path: "/job-runs",
    validateSearch: (s: Record<string, unknown>) => ({ cursor: typeof s.cursor === "string" ? s.cursor : undefined, previous: typeof s.previous === "string" ? s.previous.slice(0, 20_000) : undefined }),
    beforeLoad: async ({ location }) => { if (!(await queryClient.ensureQueryData(sessionQuery)).authenticated) throw redirect({ to: "/auth/login", search: { returnTo: location.href, token: undefined } }); },
    loaderDeps: ({ search }) => search,
    loader: ({ deps }) => queryClient.ensureQueryData(runPageQuery({ cursor: deps.cursor, limit: 20 })),
    component: lazyRouteComponent(() => import("./index"), "RunsIndex"),
  });
  const detail = createRoute({ getParentRoute: () => root, path: "/job-runs/$runId",
    validateSearch: (s: Record<string, unknown>) => ({ after: Number.isSafeInteger(Number(s.after)) && Number(s.after) >= 0 ? Number(s.after) : 0 }),
    beforeLoad: async ({ location }) => { if (!(await queryClient.ensureQueryData(sessionQuery)).authenticated) throw redirect({ to: "/auth/login", search: { returnTo: location.href, token: undefined } }); },
    loader: ({ params }) => queryClient.ensureQueryData(runStatusQuery(params.runId)),
    component: lazyRouteComponent(() => import("./detail"), "RunDetail"),
  });
  return [list, detail];
}
