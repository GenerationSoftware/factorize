import { createRoute, lazyRouteComponent, redirect, type AnyRootRoute } from "@tanstack/react-router";
import { sessionQuery } from "../auth/session";
import { queryClient } from "../../shared/query-client";
import { jobsQuery, jobQuery, type JobsSearch } from "./queries";
export function jobsRoutes(root: AnyRootRoute) {
  const guard = async ({ location }: { location: { href: string } }) => {
    if (!(await queryClient.ensureQueryData(sessionQuery)).authenticated) throw redirect({ to: "/auth/login", search: { returnTo: location.href, token: undefined } });
  };
  const jobs = createRoute({ getParentRoute: () => root, path: "/jobs", beforeLoad: guard,
    validateSearch: (s: Record<string, unknown>): JobsSearch => ({ q: typeof s.q === "string" ? s.q.slice(0, 120) : "", cursor: typeof s.cursor === "string" ? s.cursor : undefined, enabled: s.enabled === "true" || s.enabled === "false" ? s.enabled : undefined }),
    loaderDeps: ({ search }) => search,
    loader: ({ deps }) => queryClient.ensureQueryData(jobsQuery(deps)),
    component: lazyRouteComponent(() => import("./list"), "JobsList"),
  });
  const job = createRoute({ getParentRoute: () => root, path: "/jobs/$jobId", beforeLoad: guard,
    loader: ({ params }) => queryClient.ensureQueryData(jobQuery(params.jobId)),
    component: lazyRouteComponent(() => import("./detail"), "JobDetail"),
  });
  return [jobs, job];
}
