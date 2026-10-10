import { createRoute, lazyRouteComponent, redirect, type AnyRootRoute } from "@tanstack/react-router";
import { sessionQuery } from "../auth/session";
import { queryClient } from "../../shared/query-client";
import { jobsQuery, jobQuery, type JobsSearch } from "./queries";
export function jobsRoutes(root: AnyRootRoute) {
  const guard = async ({ location }: { location: { href: string } }) => {
    if (!(await queryClient.ensureQueryData(sessionQuery)).authenticated) throw redirect({ to: "/auth/login", search: { returnTo: location.href, token: undefined } });
  };
  const jobs = createRoute({ getParentRoute: () => root, path: "/jobs", beforeLoad: guard,
    validateSearch: (s: Record<string, unknown>): JobsSearch => ({ q: typeof s.q === "string" ? s.q.slice(0, 120) : "", cursor: typeof s.cursor === "string" ? s.cursor : undefined, enabled: s.enabled === "true" || s.enabled === "false" ? s.enabled : undefined, sort: s.sort === "running" || s.sort === "title" ? s.sort : undefined, order: s.order === "asc" || s.order === "desc" ? s.order : undefined }),
    loaderDeps: ({ search }) => search,
    loader: ({ deps }) => queryClient.ensureQueryData(jobsQuery(deps)),
    component: lazyRouteComponent(() => import("./list"), "JobsList"),
  });
  const job = createRoute({ getParentRoute: () => root, path: "/jobs/$jobId", beforeLoad: guard,
    validateSearch: (s: Record<string, unknown>) => ({ cursor: typeof s.cursor === "string" ? s.cursor : undefined, previous: typeof s.previous === "string" ? s.previous.slice(0, 20_000) : undefined, sort: ["run", "status", "created", "agent"].includes(String(s.sort)) ? s.sort as "run" | "status" | "created" | "agent" : undefined, direction: s.direction === "asc" || s.direction === "desc" ? s.direction : undefined }),
    loader: ({ params }) => queryClient.ensureQueryData(jobQuery(params.jobId)),
    component: lazyRouteComponent(() => import("./detail"), "JobDetail"),
  });
  const create = createRoute({ getParentRoute: () => root, path: "/jobs/new", beforeLoad: guard, component: lazyRouteComponent(() => import("./editor"), "JobEditor") });
  const edit = createRoute({ getParentRoute: () => root, path: "/jobs/$jobId/edit",
    beforeLoad: ({ params }) => { throw redirect({ to: "/jobs/$jobId/settings", params }); } });
  const settings = createRoute({ getParentRoute: () => root, path: "/jobs/$jobId/settings", beforeLoad: guard,
    loader: ({ params }) => queryClient.ensureQueryData(jobQuery(params.jobId)), component: lazyRouteComponent(() => import("./editor"), "JobEditor") });
  return [jobs, job, create, edit, settings];
}
