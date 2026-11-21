import { createRoute, lazyRouteComponent, redirect, type AnyRootRoute } from "@tanstack/react-router";
import { sessionQuery } from "../auth/session";
import { queryClient } from "../../shared/query-client";
import { runPageQuery, runStatusQuery } from "./queries";
import { runStatuses } from "../../shared/ui";
const runStates = runStatuses;
const parseRunStates = (value: unknown) => {
  const states = (Array.isArray(value) ? value : typeof value === "string" ? [value] : []).filter(state => runStates.includes(String(state) as typeof runStates[number]));
  return states.length ? states : undefined;
};
const parseRunIds = (value: unknown) => { const ids = (Array.isArray(value) ? value : typeof value === "string" ? [value] : []).filter(item => typeof item === "string") as string[]; return ids.length ? ids : undefined; };
export function runRoutes(root: AnyRootRoute) {
  const list = createRoute({ getParentRoute: () => root, path: "/runs",
    validateSearch: (s: Record<string, unknown>) => ({ skillId: typeof s.skillId === "string" ? s.skillId : undefined, cursor: typeof s.cursor === "string" ? s.cursor : undefined, previous: typeof s.previous === "string" ? s.previous.slice(0, 20_000) : undefined, triggers: parseRunIds(s.triggers), states: parseRunStates(s.states) as any, sort: ["source", "run", "status", "created", "agent"].includes(String(s.sort)) ? s.sort as "source" | "run" | "status" | "created" | "agent" : undefined, direction: s.direction === "asc" || s.direction === "desc" ? s.direction : undefined }),
    beforeLoad: async ({ location }) => { if (!(await queryClient.ensureQueryData(sessionQuery)).authenticated) throw redirect({ to: "/auth/login", search: { returnTo: location.href, token: undefined } }); },
    loaderDeps: ({ search }) => search,
    loader: ({ deps }) => { void queryClient.prefetchQuery(runPageQuery({skillId:deps.skillId, cursor: deps.cursor, limit: 20, sort: deps.sort, direction: deps.direction, states: deps.states, triggerIds: deps.triggers })); },
    component: lazyRouteComponent(() => import("./index"), "RunsIndex"),
  });
  const validateSearch = (s: Record<string, unknown>) => ({ after: Number.isSafeInteger(Number(s.after)) && Number(s.after) >= 0 ? Number(s.after) : 0 });
  const beforeLoad = async ({ location }: { location: { href: string } }) => { if (!(await queryClient.ensureQueryData(sessionQuery)).authenticated) throw redirect({ to: "/auth/login", search: { returnTo: location.href, token: undefined } }); };
  const loader = ({ params }: { params: { runId: string } }) => queryClient.ensureQueryData(runStatusQuery(params.runId));
  const component = lazyRouteComponent(() => import("./detail"), "RunDetail");
  const base = createRoute({ getParentRoute: () => root, path: "/runs/$runId",
    validateSearch, beforeLoad, loader, component,
  });
  const tab = (path: "/trace" | "/info" | "/vms") => createRoute({ getParentRoute: () => root, path: `/runs/$runId${path}`,
    validateSearch, beforeLoad, loader, component,
  });
  const contextCompatibility = createRoute({ getParentRoute: () => root, path: "/runs/$runId/context",
    validateSearch, beforeLoad: ({ params, search }) => { throw redirect({ to: "/runs/$runId/info", params, search }); },
  });
  const settingsCompatibility = createRoute({ getParentRoute: () => root, path: "/runs/$runId/settings",
    validateSearch, beforeLoad: ({ params, search }) => { throw redirect({ to: "/runs/$runId/info", params, search }); },
  });
  return [list, base, tab("/trace"), tab("/info"), tab("/vms"), settingsCompatibility, contextCompatibility];
}
