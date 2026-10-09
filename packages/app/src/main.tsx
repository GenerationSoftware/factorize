import { Button, Card, Page } from "./shared/ui";
import { ChunkRecovery } from "./shared/chunk-recovery";
import { protocolRoutes } from "./features/auth/protocol-routes";
import { settingsRoutes } from "./features/settings/routes";
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
  component: () => <IdentityBoundary><ChunkRecovery /><AccountBar /><Outlet /><footer className="mt-auto border-t border-stone-200 bg-white px-4 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400"><div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-3"><p>Open-source software factories for everybody.</p><a href="https://github.com/GenerationSoftware/factorize" className="font-medium hover:text-factorize-700 dark:hover:text-factorize-500">View on GitHub ↗</a></div></footer></IdentityBoundary>,
});
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: lazyRouteComponent(() => import("./routes/index"), "MigrationIndex"),
});
const router = createRouter({
  defaultPendingComponent: () => <Page><Card><p role="status">Loading…</p></Card></Page>,
  defaultErrorComponent: ({ error, reset }) => (
    <Page><Card><h1>Could not load this page</h1>
      <p role="alert">{error instanceof Error ? error.message : "Could not load this page."}</p>
      <Button onClick={reset}>Try again</Button>
    </Card></Page>
  ),
  defaultNotFoundComponent: () => <Page><Card><h1>Page not found</h1><p className="text-sm text-slate-600 dark:text-slate-400">Check the address or return to your software factory.</p><a href="/" className="mt-4 inline-block rounded-lg bg-factorize-500 px-4 py-2 text-sm font-semibold text-slate-950">Go to Factorize</a></Card></Page>,
  routeTree: rootRoute.addChildren([indexRoute, ...authRoutes(rootRoute), ...protocolRoutes(rootRoute), ...jobsRoutes(rootRoute), ...runRoutes(rootRoute), ...settingsRoutes(rootRoute)]),
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
