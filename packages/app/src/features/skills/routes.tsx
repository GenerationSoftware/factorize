import { createRoute, lazyRouteComponent, redirect, type AnyRootRoute } from "@tanstack/react-router";
import { queryClient } from "../../shared/query-client";
import { sessionQuery } from "../auth/session";
import { skillsQuery } from "./queries";
export function skillsRoutes(root: AnyRootRoute) { const guard = async ({ location }: { location: { href: string } }) => { if (!(await queryClient.ensureQueryData(sessionQuery)).authenticated) throw redirect({ to: "/auth/login", search: { returnTo: location.href, token: undefined } }); }; return [createRoute({ getParentRoute: () => root, path: "/skills", beforeLoad: guard, loader: () => queryClient.ensureQueryData(skillsQuery()), component: lazyRouteComponent(() => import("./library"), "SkillsLibrary") })]; }
