import { createRoute, lazyRouteComponent, redirect, notFound, type AnyRootRoute } from "@tanstack/react-router";
import { sessionQuery } from "../auth/session";
import { queryClient } from "../../shared/query-client";
import { triggerQuery, triggersQuery } from "./queries";
import { historyQuery } from "../runs/queries";
import { runStatuses } from "../../shared/ui";
const runStates = runStatuses;
const parseRunStates = (value: unknown) => {
  const states = (Array.isArray(value) ? value : typeof value === "string" ? [value] : []).filter(state => runStates.includes(String(state) as typeof runStates[number]));
  return states.length ? states : undefined;
};
export function triggersRoutes(root: AnyRootRoute) {
  const guard = async ({ location }: { location: { href: string } }) => {
    if (!(await queryClient.ensureQueryData(sessionQuery)).authenticated) throw redirect({ to: "/auth/login", search: { returnTo: location.href, token: undefined } });
  };
  const triggers = createRoute({ getParentRoute: () => root, path: "/triggers", beforeLoad: guard,
    validateSearch: (s: Record<string, unknown>) => ({ view: s.view === "graph" ? "graph" as const : undefined, q: typeof s.q === "string" ? s.q.slice(0, 120) : "", cursor: typeof s.cursor === "string" ? s.cursor : undefined, enabled: s.enabled === "true" || s.enabled === true ? "true" : s.enabled === "false" || s.enabled === false ? "false" : undefined, sort: s.sort === "running" || s.sort === "title" ? s.sort : undefined, order: s.order === "asc" || s.order === "desc" ? s.order : undefined }),
    loaderDeps: ({ search }) => ({ view: search.view, q: search.q, cursor: search.cursor, enabled: search.enabled, sort: search.sort, order: search.order }),
    loader: ({ deps }) => { if (!deps.view) void queryClient.prefetchQuery(triggersQuery(deps)); },
    component: lazyRouteComponent(() => import("./list"), "GlobalTriggersList"),
  });
  const trigger = createRoute({ getParentRoute: () => root, path: "/triggers/$triggerId", beforeLoad: guard,
    validateSearch: (s: Record<string, unknown>) => ({ cursor: typeof s.cursor === "string" ? s.cursor : undefined, previous: typeof s.previous === "string" ? s.previous.slice(0, 20_000) : undefined, states: parseRunStates(s.states) as any, sort: ["run", "status", "created", "agent"].includes(String(s.sort)) ? s.sort as "run" | "status" | "created" | "agent" : undefined, direction: s.direction === "asc" || s.direction === "desc" ? s.direction : undefined }),
    loaderDeps: ({ search }) => ({ cursor: search.cursor, sort: search.sort, direction: search.direction, states: search.states }),
    loader: ({ params, deps }) => {
      void queryClient.prefetchQuery(historyQuery(params.triggerId, deps.cursor, deps.sort, deps.direction, deps.states)).catch(() => undefined);
      return queryClient.ensureQueryData(triggerQuery(params.triggerId));
    },
    component: lazyRouteComponent(() => import("./detail"), "TriggerDetail"),
  });
  const create = createRoute({ getParentRoute: () => root, path: "/triggers/new", beforeLoad: guard, component: lazyRouteComponent(() => import("./editor"), "TriggerEditor") });
  const edit = createRoute({ getParentRoute: () => root, path: "/triggers/$triggerId/edit",
    beforeLoad: ({ params }) => { throw redirect({ to: "/triggers/$triggerId/settings", params }); } });
  const settings = createRoute({ getParentRoute: () => root, path: "/triggers/$triggerId/settings",
    beforeLoad: ({ params }) => { throw redirect({ to: "/triggers/$triggerId/settings/$section", params: { triggerId: params.triggerId, section: "general" } }); } });
  const settingsSection = createRoute({ getParentRoute: () => root, path: "/triggers/$triggerId/settings/$section", beforeLoad: async context => { await guard(context); if (!["general","vm","context","permissions","events"].includes(context.params.section)) throw notFound(); },
    loader: ({ params }) => queryClient.ensureQueryData(triggerQuery(params.triggerId)), component: lazyRouteComponent(() => import("./editor"), "TriggerEditor") });
  return [triggers, trigger, create, edit, settings, settingsSection];
}
