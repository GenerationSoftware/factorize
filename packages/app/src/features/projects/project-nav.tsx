import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumb, Page, ResourceHeader } from "../../shared/ui";
import { projectQuery } from "./queries";

export function ProjectNav({ tab, children, actions }: { tab: "jobs" | "runs" | "settings"; children?: React.ReactNode; actions?: React.ReactNode }) {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const project = useQuery(projectQuery(projectId));
  const tabClass = (name: typeof tab) => `inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-semibold ${tab === name ? "border-factorize-500 text-factorize-700 dark:text-factorize-500" : "border-transparent text-slate-600 hover:border-stone-300 dark:text-slate-300 dark:hover:border-slate-600"}`;
  return <Page className="max-w-6xl">
    <Breadcrumb><Link to="/projects">Projects</Link></Breadcrumb>
    <ResourceHeader type="Project" title={project.data?.name ?? "Project"} description={project.data?.description}>{actions}</ResourceHeader>
    <nav aria-label="Project navigation" className="-mt-3 mb-5 flex gap-1 border-b border-stone-200 dark:border-slate-800">
      <Link to="/projects/$projectId" params={{ projectId }} className={tabClass("jobs")} aria-current={tab === "jobs" ? "page" : undefined}>Jobs</Link>
      <Link to="/projects/$projectId/runs" params={{ projectId }} className={tabClass("runs")} aria-current={tab === "runs" ? "page" : undefined}>Runs</Link>
      <Link to="/projects/$projectId/settings" params={{ projectId }} className={tabClass("settings")} aria-current={tab === "settings" ? "page" : undefined}>Settings</Link>
    </nav>
    {project.isPending && <p role="status">Loading project…</p>}{project.error && <p role="alert">{project.error.message}</p>}
    {children}
  </Page>;
}
