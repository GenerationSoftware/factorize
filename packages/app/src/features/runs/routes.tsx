import { createRoute, lazyRouteComponent, redirect, type AnyRootRoute } from "@tanstack/react-router";
import { sessionQuery } from "../auth/session";
import { queryClient } from "../../shared/query-client";
import { runPageQuery, runStatusQuery } from "./queries";
export function runRoutes(root: AnyRootRoute) {
  const list = createRoute({ getParentRoute: () => root, path: "/job-runs",
    validateSearch: (s: Record<string, unknown>) => { const states = (Array.isArray(s.states) ? s.states : typeof s.states === "string" ? [s.states] : []).filter(state => ["queued", "starting", "running", "blocked", "stopping", "succeeded", "failed", "stopped", "ignored", "done"].includes(String(state))) as any; return { cursor: typeof s.cursor === "string" ? s.cursor : undefined, previous: typeof s.previous === "string" ? s.previous.slice(0, 20_000) : undefined, states: states.length ? states : undefined, sort: ["job", "run", "status", "created", "agent"].includes(String(s.sort)) ? s.sort as "job" | "run" | "status" | "created" | "agent" : undefined, direction: s.direction === "asc" || s.direction === "desc" ? s.direction : undefined }; },
    beforeLoad: async ({ location }) => { if (!(await queryClient.ensureQueryData(sessionQuery)).authenticated) throw redirect({ to: "/auth/login", search: { returnTo: location.href, token: undefined } }); },
    loaderDeps: ({ search }) => search,
    loader: ({ deps }) => queryClient.ensureQueryData(runPageQuery({ cursor: deps.cursor, limit: 20, sort: deps.sort, direction: deps.direction })),
    component: lazyRouteComponent(() => import("./index"), "RunsIndex"),
  });
  const validateSearch = (s: Record<string, unknown>) => ({ after: Number.isSafeInteger(Number(s.after)) && Number(s.after) >= 0 ? Number(s.after) : 0 });
  const beforeLoad = async ({ location }: { location: { href: string } }) => { if (!(await queryClient.ensureQueryData(sessionQuery)).authenticated) throw redirect({ to: "/auth/login", search: { returnTo: location.href, token: undefined } }); };
  const loader = ({ params }: { params: { runId: string } }) => queryClient.ensureQueryData(runStatusQuery(params.runId));
  const component = lazyRouteComponent(() => import("./detail"), "RunDetail");
  const base = createRoute({ getParentRoute: () => root, path: "/job-runs/$runId",
    validateSearch, beforeLoad, loader, component,
  });
  const tab = (path: "/trace" | "/info" | "/settings") => createRoute({ getParentRoute: () => root, path: `/job-runs/$runId${path}`,
    validateSearch, beforeLoad, loader, component,
  });
  const contextCompatibility = createRoute({ getParentRoute: () => root, path: "/job-runs/$runId/context",
    validateSearch, beforeLoad: ({ params, search }) => { throw redirect({ to: "/job-runs/$runId/info", params, search }); },
  });
  return [list, base, tab("/trace"), tab("/info"), tab("/settings"), contextCompatibility];
}
