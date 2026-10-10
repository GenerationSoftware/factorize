import { createRoute, lazyRouteComponent, redirect, type AnyRootRoute } from "@tanstack/react-router";
import type { AuthMode } from "./auth-screen";
import { sessionQuery } from "./session";
import { queryClient } from "../../shared/query-client";

const Screen = lazyRouteComponent(() => import("./auth-screen"), "AuthScreen");
const validateSearch = (input: Record<string, unknown>): { token?: string; returnTo?: string; connection?: string; expired?: boolean } => ({
  connection: typeof input.connection === "string" ? input.connection : undefined,
  expired: input.expired === "1",
  token: typeof input.token === "string" ? input.token : undefined,
  returnTo: typeof input.returnTo === "string" ? input.returnTo : undefined,
});
export function authRoutes(rootRoute: AnyRootRoute) {
  function route(path: "/auth/login" | "/auth/signup" | "/auth/password-reset" | "/auth/verify" | "/auth/verify/request" | "/settings/password", mode: AuthMode) {
    return createRoute({
      getParentRoute: () => rootRoute, path, validateSearch,
      component: () => <Screen mode={mode} />,
      ...(mode === "password" ? { beforeLoad: async () => {
        const session = await queryClient.ensureQueryData(sessionQuery);
        if (!session.authenticated) {
          throw redirect({ to: "/auth/login", search: { returnTo: "/settings/password", token: undefined } });
        }
      } } : {}),
    });
  }
  return [route("/auth/login", "login"), route("/auth/signup", "signup"), route("/auth/password-reset", "reset"), route("/auth/verify", "verify"), route("/auth/verify/request", "verify-request"), route("/settings/password", "password")];
}
