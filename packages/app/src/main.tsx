import { jobsRoutes } from "./features/jobs/routes";
import { runRoutes } from "./features/runs/routes";
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute, createRoute, createRouter, lazyRouteComponent,
  Outlet, RouterProvider,
} from "@tanstack/react-router";
import { AccountBar } from "./features/auth/account-bar";
import { authRoutes } from "./features/auth/routes";
import { IdentityBoundary } from "./features/auth/identity-boundary";
import { queryClient } from "./shared/query-client";
import "./styles.css";

const rootRoute = createRootRoute({
  component: () => <IdentityBoundary><AccountBar /><Outlet /></IdentityBoundary>,
});
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: lazyRouteComponent(() => import("./routes/index"), "MigrationIndex"),
});
const router = createRouter({
  defaultPendingComponent: () => <p role="status" className="p-6">Loading…</p>,
  defaultErrorComponent: ({ error, reset }) => (
    <main className="p-6">
      <p role="alert">{error instanceof Error ? error.message : "Could not load this page."}</p>
      <button onClick={reset}>Try again</button>
    </main>
  ),
  defaultNotFoundComponent: () => <main className="p-6"><h1>Page not found</h1></main>,
  routeTree: rootRoute.addChildren([indexRoute, ...authRoutes(rootRoute), ...jobsRoutes(rootRoute), ...runRoutes(rootRoute)]),
});
declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
