import { createRoute, lazyRouteComponent, redirect, type AnyRootRoute } from "@tanstack/react-router";
import { sessionQuery } from "../auth/session";
import { queryClient } from "../../shared/query-client";
import { runStatusQuery } from "./queries";
export function runRoutes(root: AnyRootRoute) {
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
  return [base, tab("/trace"), tab("/info"), tab("/settings"), contextCompatibility];
}
