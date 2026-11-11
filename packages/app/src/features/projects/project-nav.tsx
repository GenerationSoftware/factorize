import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Page } from "../../shared/ui";
import { projectQuery } from "./queries";

type ProjectTab = "jobs" | "runs" | "settings";

const tabs: Array<{ id: ProjectTab; label: string; to: "/projects/$projectId" | "/projects/$projectId/runs" | "/projects/$projectId/settings"; icon: React.ReactNode }> = [
  { id: "jobs", label: "Jobs", to: "/projects/$projectId", icon: <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-[18px]"><rect x="3.5" y="7" width="17" height="13.5" rx="2"/><path strokeLinecap="round" strokeLinejoin="round" d="M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7M3.5 12h17m-10 0v1.5h3V12"/></svg> },
  { id: "runs", label: "Runs", to: "/projects/$projectId/runs", icon: <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-[18px]"><circle cx="12" cy="12" r="9"/><path fill="currentColor" stroke="none" d="m10 8 6 4-6 4z"/></svg> },
  { id: "settings", label: "Settings", to: "/projects/$projectId/settings", icon: <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-[18px]"><path strokeLinecap="round" strokeLinejoin="round" d="M10 3.8h4l.6 2.1 1.6.9 2.1-.6 2 3.5-1.5 1.6v1.8l1.5 1.6-2 3.5-2.1-.6-1.6.9-.6 2.1h-4l-.6-2.1-1.6-.9-2.1.6-2-3.5 1.5-1.6v-1.8L3.7 9.7l2-3.5 2.1.6 1.6-.9z"/><circle cx="12" cy="12" r="3"/></svg> },
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
