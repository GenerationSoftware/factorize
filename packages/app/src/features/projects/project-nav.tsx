import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Page } from "../../shared/ui";
import { NavIcon } from "../../shared/nav-icon";
import { projectQuery } from "./queries";

type ProjectTab = "jobs" | "runs" | "settings";

const tabs: Array<{ id: ProjectTab; label: string; to: "/projects/$projectId" | "/projects/$projectId/runs" | "/projects/$projectId/settings"; icon: React.ReactNode }> = [
  { id: "jobs", label: "Jobs", to: "/projects/$projectId", icon: <NavIcon name="jobs" /> },
  { id: "runs", label: "Runs", to: "/projects/$projectId/runs", icon: <NavIcon name="runs" /> },
  { id: "settings", label: "Settings", to: "/projects/$projectId/settings", icon: <NavIcon name="settings" /> },
];

export function ProjectNav({ tab, projectId: projectIdProp, children }: { tab: ProjectTab; projectId?: string; children?: React.ReactNode }) {
  const params = useParams({ strict: false }) as { projectId?: string };
  const projectId = projectIdProp ?? params.projectId;
  if (!projectId) return null;
  const project = useQuery(projectQuery(projectId));
  return <>
    <nav aria-label="Project navigation" className="border-y border-stone-200 bg-white dark:border-slate-800 dark:bg-slate-950">
      <div className="mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto px-4 sm:px-6 lg:px-8">
        {tabs.map(item => <Link key={item.id} to={item.to} params={{ projectId }} className={`inline-flex min-h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-factorize-500 ${tab === item.id ? "border-factorize-500 text-factorize-700 dark:text-factorize-500" : "border-transparent text-slate-600 hover:border-stone-300 hover:text-slate-950 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-white"}`} aria-current={tab === item.id ? "page" : undefined}>{item.icon}{item.label}</Link>)}
      </div>
    </nav>
    <Page className="pt-6 sm:pt-8">
      <h1 className="sr-only">{project.data?.name ?? "Project"} {tab === "jobs" ? "jobs" : tab === "runs" ? "runs" : "settings"}</h1>
      {project.isPending && <p role="status">Loading project…</p>}{project.error && <p role="alert">{project.error.message}</p>}
      {children}
    </Page>
  </>;
}
